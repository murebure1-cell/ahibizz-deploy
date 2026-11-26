import type { Pool } from "pg";
import { type BusinessMenu, readBusinessMenu } from "../lib/business-menu";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import type { AuthService } from "./auth/service";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Query = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

function rowMenu(row: Record<string, unknown> | undefined): BusinessMenu {
  if (!row) return { items: [], meat: [], version: 0 };
  try {
    return {
      ...readBusinessMenu({ items: row.items, meat: row.meat }),
      version: Number(row.version),
    };
  } catch {
    return { items: [], meat: [], version: Number(row.version) || 0 };
  }
}

/** The menu of a published business of an approved owner; empty when there is none. */
export async function readPublicMenu(database: Query, businessId: string): Promise<BusinessMenu> {
  if (!uuid.test(businessId)) return { items: [], meat: [], version: 0 };
  const { rows } = await database.query(
    `SELECT m.items, m.meat, m.version FROM business_menu m
     JOIN directory_business b ON b.id=m.business_id JOIN auth_user u ON u.id=b.owner_user_id
     WHERE m.business_id=$1 AND b.deleted_at IS NULL AND b.status='published'
       AND u.approval='approved' AND u."emailVerified"`,
    [businessId],
  );
  return rowMenu(rows[0]);
}

async function ownBusiness(
  client: Query,
  businessId: string,
  userId: string,
  lock: boolean,
): Promise<{ title: string }> {
  if (!uuid.test(businessId)) throw new AccountAccessError(404, "BUSINESS_NOT_FOUND");
  const { rows } = await client.query(
    `SELECT title FROM directory_business WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL
     AND status<>'archived' ${lock ? "FOR UPDATE" : ""}`,
    [businessId, userId],
  );
  if (!rows[0]) throw new AccountAccessError(404, "BUSINESS_NOT_FOUND");
  return { title: String(rows[0].title) };
}

/** The owner's own view of the menu, for editing. */
export async function readOwnMenu(
  auth: AuthService,
  pool: Pool,
  headers: Headers,
  businessId: string,
) {
  const access = createAccountAccess(auth);
  const session = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const user = await access.authority(client, session, false, "read");
    const business = await ownBusiness(client, businessId, user.id, false);
    const { rows } = await client.query(
      "SELECT items, meat, version FROM business_menu WHERE business_id=$1",
      [businessId],
    );
    return { business, menu: rowMenu(rows[0]) };
  });
}

/** Replaces the menu; `expectedVersion` guards against a second open editor. */
export async function saveOwnMenu(
  auth: AuthService,
  pool: Pool,
  headers: Headers,
  businessId: string,
  input: unknown,
) {
  const value = input as { expectedVersion?: unknown } | null;
  let menu: ReturnType<typeof readBusinessMenu>;
  try {
    menu = readBusinessMenu(input);
  } catch {
    throw new AccountAccessError(400, "INVALID_MENU");
  }
  if (!Number.isSafeInteger(value?.expectedVersion) || (value?.expectedVersion as number) < 0)
    throw new AccountAccessError(400, "INVALID_MENU");
  const access = createAccountAccess(auth);
  const session = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const user = await access.authority(client, session, false, "write");
    await ownBusiness(client, businessId, user.id, true);
    const current = (
      await client.query("SELECT version FROM business_menu WHERE business_id=$1 FOR UPDATE", [
        businessId,
      ])
    ).rows[0] as { version: number } | undefined;
    if ((current?.version ?? 0) !== value?.expectedVersion)
      throw new AccountAccessError(409, "VERSION_CONFLICT");
    const { rows } = await client.query(
      `INSERT INTO business_menu (business_id, items, meat, version, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, 1, $4, clock_timestamp())
       ON CONFLICT (business_id) DO UPDATE SET items=EXCLUDED.items, meat=EXCLUDED.meat,
         version=business_menu.version+1, updated_by=EXCLUDED.updated_by, updated_at=clock_timestamp()
       RETURNING items, meat, version`,
      [businessId, JSON.stringify(menu.items), JSON.stringify(menu.meat), user.id],
    );
    return rowMenu(rows[0]);
  });
}
