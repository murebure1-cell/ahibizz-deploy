import type { Pool, PoolClient } from "pg";
import { AccountAccessError, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";

/**
 * One-time reset before launch: every business, every account except the owner accounts, and
 * everything that belongs to them. Categories, articles, design and prices stay. The table list is
 * read from the database's own foreign keys, so a table added later cannot be forgotten.
 * Remove this module and its page after the reset has been used.
 */
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

type Edge = { child: string; parent: string; action: string; columns: string[] };
export type PrelaunchResetPlan = {
  owners: { id: string; email: string }[];
  accounts: number;
  businesses: number;
  tables: { name: string; rows: number }[];
  blockers: string[];
};

function quoted(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unexpected database identifier.");
  return `"${name}"`;
}
async function rows<T>(client: PoolClient, text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query(text, values)).rows as T[];
}
async function count(client: PoolClient, text: string, values: unknown[] = []): Promise<number> {
  return (await rows<{ n: number }>(client, text, values))[0]?.n ?? 0;
}

async function readPlan(client: PoolClient): Promise<PrelaunchResetPlan & { kept: string[] }> {
  const blockers: string[] = [];
  const present = new Set(
    (
      await rows<{ name: string }>(
        client,
        `SELECT c.relname AS name FROM pg_class c
         WHERE c.relnamespace=current_schema()::regnamespace AND c.relkind IN ('r','p')`,
      )
    ).map((row) => row.name),
  );
  const edges = await rows<Edge>(
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
      await rows<{ name: string }>(
        client,
        `SELECT DISTINCT c.relname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         WHERE NOT t.tgisinternal AND c.relnamespace=current_schema()::regnamespace
           AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0`,
      )
    ).map((row) => row.name),
  );

  const emptied = new Set<string>();
  const queue: string[] = [];
  const add = (table: string) => {
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
  const reached = new Set<string>([accountTable]);
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
    const parent = queue.shift() as string;
    for (const edge of edges) if (edge.parent === parent && edge.child !== parent) add(edge.child);
  }

  const owners = await rows<{ id: string; email: string }>(
    client,
    `SELECT id,email FROM auth_user WHERE role='owner' AND erased_at IS NULL ORDER BY "createdAt",id`,
  );
  if (!owners.length) blockers.push("Nema vlasničkog naloga koji bi ostao.");
  const kept = new Set(owners.map((owner) => owner.id));
  for (const edge of edges) {
    if (edge.parent !== accountTable || !preservedTables.has(edge.child)) continue;
    const column = quoted(edge.columns[0] as string);
    for (const row of await rows<{ id: string }>(
      client,
      `SELECT DISTINCT ${column} AS id FROM ${quoted(edge.child)} WHERE ${column} IS NOT NULL`,
    ))
      kept.add(row.id);
  }
  const keptIds = [...kept];
  for (const edge of edges) {
    if (edge.parent !== accountTable || !configurationTables.has(edge.child)) continue;
    const column = quoted(edge.columns[0] as string);
    const n = await count(
      client,
      `SELECT count(*)::integer AS n FROM ${quoted(edge.child)}
       WHERE ${column} IS NOT NULL AND NOT (${column} = ANY($1::text[]))`,
      [keptIds],
    );
    if (n) blockers.push(`Postavke u ${edge.child} je mijenjao nalog koji se briše.`);
  }
  for (const table of financialTables) {
    if (!present.has(table)) continue;
    const n = await count(client, `SELECT count(*)::integer AS n FROM ${quoted(table)}`);
    if (n) blockers.push(`Tabela ${table} sadrži ${n} finansijskih zapisa.`);
  }

  const tables: { name: string; rows: number }[] = [];
  for (const name of [...emptied].sort()) {
    tables.push({
      name,
      rows: await count(client, `SELECT count(*)::integer AS n FROM ${quoted(name)}`),
    });
  }
  const accounts = await count(
    client,
    "SELECT count(*)::integer AS n FROM auth_user WHERE NOT (id = ANY($1::text[]))",
    [keptIds],
  );
  return {
    owners,
    accounts,
    businesses: tables.find((table) => table.name === businessTable)?.rows ?? 0,
    tables,
    blockers,
    kept: keptIds,
  };
}

async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  }
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    if (error instanceof AccountAccessError) throw error;
    throw new AccountAccessError(503, "RESET_UNAVAILABLE");
  } finally {
    client.release(discard);
  }
}

export function createPrelaunchReset(auth: AuthService, pool: Pool, now = () => Date.now()) {
  const access = createAccountAccess(auth);
  function open() {
    if (now() >= prelaunchResetClosesAt) throw new AccountAccessError(410, "RESET_CLOSED");
  }
  return {
    /** Counts only; nothing is changed. */
    async plan(headers: Headers) {
      open();
      const current = await access.session(headers);
      return transaction(pool, async (client) => {
        const operator = await access.authority(client, current, true, "read");
        const { kept: _kept, ...plan } = await readPlan(client);
        return { plan, operatorId: operator.id };
      });
    },
    /** The signed-in owner repeats their own email. Everything happens in one transaction. */
    async apply(headers: Headers, confirmedEmail: unknown) {
      open();
      if (typeof confirmedEmail !== "string" || confirmedEmail.length > 254)
        throw new AccountAccessError(400, "INVALID_RESET_CONFIRMATION");
      const current = await access.session(headers);
      return transaction(pool, async (client) => {
        const operator = await access.authority(client, current, true);
        if (confirmedEmail.trim().toLowerCase() !== operator.email.toLowerCase())
          throw new AccountAccessError(400, "INVALID_RESET_CONFIRMATION");
        const plan = await readPlan(client);
        if (plan.blockers.length || !plan.kept.includes(operator.id))
          throw new AccountAccessError(409, "RESET_BLOCKED");
        if (plan.tables.length)
          await client.query(`TRUNCATE TABLE ${plan.tables.map((t) => quoted(t.name)).join(",")}`);
        const removed = await client.query(
          "DELETE FROM auth_user WHERE NOT (id = ANY($1::text[]))",
          [plan.kept],
        );
        await client.query(
          `INSERT INTO platform_settings(key,value) VALUES('maintenance.prelaunch_reset',$1::jsonb)
           ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
          [
            JSON.stringify({
              appliedAt: new Date(now()).toISOString(),
              operatorId: operator.id,
              accounts: removed.rowCount ?? 0,
              businesses: plan.businesses,
              rows: plan.tables.reduce((sum, table) => sum + table.rows, 0),
            }),
          ],
        );
        return { accounts: removed.rowCount ?? 0, businesses: plan.businesses };
      });
    },
  };
}

export function getPrelaunchReset() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createPrelaunchReset(auth, pool) : null;
}
