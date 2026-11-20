import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { type FavoriteCommand, favoriteId } from "../../lib/favorites";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import { listDirectory, publicDto } from "../directory/read-service";

export class FavoritesAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function fail(status: number, code: string): never {
  throw new FavoritesAccessError(status, code);
}
export function favoriteIds(ids: unknown): string[] {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 50 ||
    ids.some((id) => !favoriteId(id)) ||
    new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
  )
    fail(400, "INVALID_FAVORITE_INPUT");
  return ids.map((id) => id.toLowerCase());
}
export function favoriteCommand(value: unknown): FavoriteCommand {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "INVALID_FAVORITE_INPUT");
  const v = value as FavoriteCommand;
  if (
    Object.keys(v).length !== 3 ||
    Object.keys(v).some((k) => !["saved", "expectedVersion", "idempotencyKey"].includes(k)) ||
    typeof v.saved !== "boolean" ||
    !Number.isInteger(v.expectedVersion) ||
    v.expectedVersion < 0 ||
    v.expectedVersion > 2147483646 ||
    !favoriteId(v.idempotencyKey)
  )
    fail(400, "INVALID_FAVORITE_INPUT");
  return {
    saved: v.saved,
    expectedVersion: v.expectedVersion,
    idempotencyKey: v.idempotencyKey.toLowerCase(),
  };
}
type Session = { id: string; userId: string; token: string; expected: string | null };
type State = { businessId: string; saved: boolean; version: number };
function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (
    user.approval !== "approved" ||
    !user.emailVerified ||
    !["member", "owner"].includes(user.role)
  )
    fail(403, "ACCOUNT_ACCESS_DENIED");
}
async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let begun = false,
    discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    begun = true;
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL statement_timeout='2s'");
    const result = await body(client);
    await client.query("COMMIT");
    begun = false;
    return result;
  } catch (error) {
    if (begun)
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    if (error instanceof FavoritesAccessError) throw error;
    if (error instanceof AccountAccessError)
      throw new FavoritesAccessError(error.status, error.code);
    throw new FavoritesAccessError(503, "FAVORITES_UNAVAILABLE");
  } finally {
    client.release(discard);
  }
}
async function fresh(client: PoolClient, session: Session) {
  const result = await client.query(
    'WITH locked AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked WHERE "expiresAt">clock_timestamp()',
    [session.id, session.userId, session.token],
  );
  if (result.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
}
async function authority(client: PoolClient, session: Session, others: string[] = []) {
  const rows = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
      [[...new Set([session.userId, ...others])].sort()],
    )
  ).rows;
  const actor = rows.find((row) => row.id === session.userId);
  eligible(actor);
  if (session.expected && session.expected !== actor.id) fail(401, "ACCOUNT_IDENTITY_CHANGED");
  await fresh(client, session);
  return { actor, users: rows };
}
const publicEligibility = `b.status='published' AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified"=true AND u.role IN ('member','owner')`;
export function createFavoritesService({
  accounts,
  auth,
  pool,
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
}) {
  async function session(headers: Headers, required = false): Promise<Session> {
    const expected = headers.get("X-AhiBizz-Account-ID");
    if (
      (required && expected === null) ||
      (expected !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expected))
    )
      fail(400, "INVALID_FAVORITE_INPUT");
    const identity = await accounts.read(headers),
      signed = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
    if (!signed?.session || signed.session.userId !== identity.id || signed.user.id !== identity.id)
      fail(401, "AUTHENTICATION_REQUIRED");
    return { id: signed.session.id, userId: identity.id, token: signed.session.token, expected };
  }
  return {
    async states(headers: Headers, idsInput: unknown) {
      const ids = favoriteIds(idsInput),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, signed);
        const items = (
          await client.query<State>(
            `SELECT b.id AS "businessId",COALESCE(f.saved,false) AS saved,COALESCE(f.version,0) AS version FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id LEFT JOIN business_favorite f ON f.business_id=b.id AND f.user_id=$1 WHERE b.id=ANY($2::uuid[]) AND ${publicEligibility} ORDER BY b.id`,
            [actor.id, ids],
          )
        ).rows;
        return { accountId: actor.id, items };
      });
    },
    async list(headers: Headers, page = 1) {
      if (!Number.isInteger(page) || page < 1 || page > 1000) fail(400, "INVALID_FAVORITE_INPUT");
      const signed = await session(headers, true);
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, signed);
        const result = await listDirectory(
          client,
          { page, pageSize: 20 },
          `${publicEligibility} AND EXISTS(SELECT 1 FROM business_favorite f WHERE f.business_id=b.id AND f.user_id=$1 AND f.saved)`,
          [actor.id],
          true,
        );
        return { accountId: actor.id, ...result, items: result.items.map(publicDto) };
      });
    },
    async set(headers: Headers, businessId: string, value: unknown) {
      if (!favoriteId(businessId)) fail(400, "INVALID_FAVORITE_INPUT");
      const id = businessId.toLowerCase(),
        command = favoriteCommand(value),
        signed = await session(headers, true);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ id, ...command }))
        .digest("hex");
      return transaction(pool, async (client) => {
        const hint = (
          await client.query<{ owner_user_id: string }>(
            "SELECT owner_user_id FROM directory_business WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (!hint) fail(404, "BUSINESS_NOT_FOUND");
        const { actor } = await authority(client, signed, [hint.owner_user_id]);
        const b = (
          await client.query<{ owner_user_id: string }>(
            "SELECT owner_user_id FROM directory_business WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!b || b.owner_user_id !== hint.owner_user_id) fail(409, "VERSION_CONFLICT");
        const before = (
          await client.query<State>(
            'SELECT business_id AS "businessId",saved,version FROM business_favorite WHERE user_id=$1 AND business_id=$2 FOR UPDATE',
            [actor.id, id],
          )
        ).rows[0];
        const visible = Boolean(
          (
            await client.query(
              `SELECT b.id FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.id=$1 AND ${publicEligibility}`,
              [id],
            )
          ).rowCount,
        );
        if (!visible && (command.saved || !before)) fail(404, "BUSINESS_NOT_FOUND");
        await fresh(client, signed);
        const receipt = (
          await client.query<{
            fingerprint: string;
            result_version: number;
            result_saved: boolean;
          }>(
            "SELECT fingerprint,result_version,result_saved FROM business_favorite_command WHERE user_id=$1 AND request_id=$2",
            [actor.id, command.idempotencyKey],
          )
        ).rows[0];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail(409, "IDEMPOTENCY_CONFLICT");
          if (before?.version !== receipt.result_version || before.saved !== receipt.result_saved)
            fail(409, "VERSION_CONFLICT");
          return { accountId: actor.id, items: [before] };
        }
        if ((before?.version ?? 0) !== command.expectedVersion) fail(409, "VERSION_CONFLICT");
        const after = (
          await client.query<State>(
            'INSERT INTO business_favorite(user_id,business_id,saved,version) VALUES($1,$2,$3,1) ON CONFLICT(user_id,business_id) DO UPDATE SET saved=EXCLUDED.saved,version=business_favorite.version+1,updated_at=now() RETURNING business_id AS "businessId",saved,version',
            [actor.id, id, command.saved],
          )
        ).rows[0];
        if (!after) fail(409, "VERSION_CONFLICT");
        await client.query(
          "INSERT INTO business_favorite_command(user_id,request_id,business_id,fingerprint,result_version,result_saved) VALUES($1,$2,$3,$4,$5,$6)",
          [actor.id, command.idempotencyKey, id, fingerprint, after.version, after.saved],
        );
        return { accountId: actor.id, items: [after] };
      });
    },
  };
}
export type FavoritesService = ReturnType<typeof createFavoritesService>;
let shared: FavoritesService | undefined;
export function getFavoritesService() {
  if (shared) return shared;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  shared = createFavoritesService({ accounts, auth, pool });
  return shared;
}
