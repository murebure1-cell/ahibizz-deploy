// One-time reset before launch: every business, every account except the owner accounts, and
// everything that belongs to them. Categories, articles, design and prices stay. The table list is
// read from the database's own foreign keys, so a table added later cannot be forgotten.
// Shared by the owner page (src/server/maintenance/prelaunch-reset.ts) and the operator command
// (scripts/prelaunch-reset.mjs). Remove all three after the reset has been used.
import { createHash } from "node:crypto";

export const prelaunchResetClosesAt = Date.UTC(2026, 11, 5);

const accountTable = "auth_user";
const businessTable = "directory_business";
/** Price lists and rates that only an owner edits; they survive with their owner reference. */
const configurationTables = new Set([
  "live_package_benefits",
  "ahi_credit_rate",
  "promotion_price",
]);
/** Proof that an erasure request was fulfilled. The anonymized account behind it stays. */
const preservedTables = new Set(["account_erasure_receipt"]);
/** Confirmed money. A row here stops the reset; an owner decides about it separately. */
const financialTables = ["billing_receipt", "billing_development_ledger"];
/** Personal or stale rows that no foreign key would reach. */
const residueTables = ["account_activity", "push_delivery", "auth_verification", "auth_rate_limit"];

function quoted(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unexpected database identifier.");
  return `"${name}"`;
}
async function rows(client, text, values = []) {
  return (await client.query(text, values)).rows;
}
async function count(client, text, values = []) {
  return (await rows(client, text, values))[0]?.n ?? 0;
}

/** Counts only; nothing is changed. The digest covers what would be removed, not volatile counts. */
export async function readPrelaunchResetPlan(client) {
  const blockers = [];
  const present = new Set(
    (
      await rows(
        client,
        `SELECT c.relname AS name FROM pg_class c
         WHERE c.relnamespace=current_schema()::regnamespace AND c.relkind IN ('r','p')`,
      )
    ).map((row) => row.name),
  );
  const edges = await rows(
    client,
    `SELECT child.relname AS child, parent.relname AS parent, c.confdeltype::text AS action,
            array_agg(a.attname::text ORDER BY k.ord) AS columns
     FROM pg_constraint c
     JOIN pg_class child ON child.oid=c.conrelid
     JOIN pg_class parent ON parent.oid=c.confrelid
     JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord) ON true
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
     WHERE c.contype='f' AND c.connamespace=current_schema()::regnamespace
     GROUP BY c.oid, child.relname, parent.relname, c.confdeltype`,
  );
  // Row triggers that refuse a delete would also refuse the cascade from a removed account.
  const guarded = new Set(
    (
      await rows(
        client,
        `SELECT DISTINCT c.relname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         WHERE NOT t.tgisinternal AND c.relnamespace=current_schema()::regnamespace
           AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0`,
      )
    ).map((row) => row.name),
  );

  const emptied = new Set();
  const queue = [];
  const add = (table) => {
    if (table === accountTable || preservedTables.has(table) || emptied.has(table)) return;
    if (configurationTables.has(table)) {
      blockers.push(`Tabela postavki ${table} zavisi od podataka koji se brišu.`);
      return;
    }
    emptied.add(table);
    queue.push(table);
  };
  if (present.has(businessTable)) add(businessTable);
  for (const edge of edges) {
    if (edge.parent !== accountTable || configurationTables.has(edge.child)) continue;
    // RESTRICT and NO ACTION keep an account alive; a guarded table cannot follow a cascade.
    if (edge.action === "r" || edge.action === "a" || guarded.has(edge.child)) add(edge.child);
  }
  // The same holds further down a cascade: account -> profile -> guarded history.
  const reached = new Set([accountTable]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const edge of edges)
      if (reached.has(edge.parent) && !reached.has(edge.child)) {
        reached.add(edge.child);
        grew = true;
      }
  }
  for (const table of guarded)
    if (reached.has(table) && !configurationTables.has(table)) add(table);
  for (const table of residueTables) if (present.has(table)) add(table);
  while (queue.length) {
    const parent = queue.shift();
    for (const edge of edges) if (edge.parent === parent && edge.child !== parent) add(edge.child);
  }

  const owners = await rows(
    client,
    `SELECT id,email FROM auth_user WHERE role='owner' AND erased_at IS NULL ORDER BY "createdAt",id`,
  );
  if (!owners.length) blockers.push("Nema vlasničkog naloga koji bi ostao.");
  const keptSet = new Set(owners.map((owner) => owner.id));
  for (const edge of edges) {
    if (edge.parent !== accountTable || !preservedTables.has(edge.child)) continue;
    const column = quoted(edge.columns[0]);
    for (const row of await rows(
      client,
      `SELECT DISTINCT ${column} AS id FROM ${quoted(edge.child)} WHERE ${column} IS NOT NULL`,
    ))
      keptSet.add(row.id);
  }
  const kept = [...keptSet];
  for (const edge of edges) {
    if (edge.parent !== accountTable || !configurationTables.has(edge.child)) continue;
    const column = quoted(edge.columns[0]);
    const n = await count(
      client,
      `SELECT count(*)::integer AS n FROM ${quoted(edge.child)}
       WHERE ${column} IS NOT NULL AND NOT (${column} = ANY($1::text[]))`,
      [kept],
    );
    if (n) blockers.push(`Postavke u ${edge.child} je mijenjao nalog koji se briše.`);
  }
  for (const table of financialTables) {
    if (!present.has(table)) continue;
    const n = await count(client, `SELECT count(*)::integer AS n FROM ${quoted(table)}`);
    if (n) blockers.push(`Tabela ${table} sadrži ${n} finansijskih zapisa.`);
  }

  const tables = [];
  for (const name of [...emptied].sort())
    tables.push({
      name,
      rows: await count(client, `SELECT count(*)::integer AS n FROM ${quoted(name)}`),
    });
  const accounts = await count(
    client,
    "SELECT count(*)::integer AS n FROM auth_user WHERE NOT (id = ANY($1::text[]))",
    [kept],
  );
  const businesses = tables.find((table) => table.name === businessTable)?.rows ?? 0;
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        kept: [...kept].sort(),
        accounts,
        businesses,
        tables: tables.map((table) => table.name),
        blockers,
      }),
    )
    .digest("hex");
  return { owners, accounts, businesses, tables, blockers, kept, digest };
}

/** Runs inside the caller's transaction. Refuses a plan that has anything standing in its way. */
export async function applyPrelaunchResetPlan(client, plan, operatorId, now = Date.now()) {
  if (plan.blockers.length || !plan.kept.length) throw new Error("The reset plan is blocked.");
  if (plan.tables.length)
    await client.query(
      `TRUNCATE TABLE ${plan.tables.map((table) => quoted(table.name)).join(",")}`,
    );
  const removed = await client.query("DELETE FROM auth_user WHERE NOT (id = ANY($1::text[]))", [
    plan.kept,
  ]);
  const accounts = removed.rowCount ?? 0;
  await client.query(
    `INSERT INTO platform_settings(key,value) VALUES('maintenance.prelaunch_reset',$1::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    [
      JSON.stringify({
        appliedAt: new Date(now).toISOString(),
        operatorId,
        accounts,
        businesses: plan.businesses,
        rows: plan.tables.reduce((sum, table) => sum + table.rows, 0),
      }),
    ],
  );
  return { accounts, businesses: plan.businesses };
}
