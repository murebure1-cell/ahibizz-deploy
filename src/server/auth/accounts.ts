import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { readOwnerOverview } from "../account-overview";
import { readAdminTodayQueues } from "../admin-today";
import { readBusinessToday } from "../business-today";
import { clearAttempts, countAttempt } from "./attempt-limit";
import { bootstrapInitialOwnerRecord, InitialOwnerError } from "./initial-owner";
import {
  type AccountApproval,
  type AuthService,
  type CurrentAuthUser,
  getAuthDatabasePool,
  getAuthService,
} from "./service";

export type AccountLocale = "bs" | "en" | "de" | "ar" | "tr";
export type AccountAppearance = "system" | "light" | "dark";
export type SafeAccountProfile = CurrentAuthUser & {
  locale: AccountLocale;
  appearance: AccountAppearance;
};
export type AccountListInput = { approval: AccountApproval; page: number; q: string };
export type AccountListPage = {
  accounts: SafeAccountProfile[];
  approval: AccountApproval;
  page: number;
  hasMore: boolean;
  limit: 30;
};
export class AccountAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Account action could not be completed.");
  }
}
const approvals: AccountApproval[] = ["pending", "approved", "suspended"];
const profileColumns =
  "u.id, u.name, u.email, u.\"emailVerified\", u.role, u.approval, COALESCE(p.locale, 'bs') AS locale, COALESCE(p.appearance, 'system') AS appearance";
const profileJoin = "auth_user u LEFT JOIN auth_account_preferences p ON p.user_id = u.id";
function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}

function eligible(
  user: CurrentAuthUser | undefined,
  owner = false,
): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (user.emailVerified !== true) fail(403, "EMAIL_NOT_VERIFIED");
  if (user.role !== "member" && user.role !== "owner") fail(403, "ACCOUNT_ACCESS_DENIED");
  if (owner && user.role !== "owner") fail(403, "OWNER_REQUIRED");
}
function object(input: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    fail(400, "UNEXPECTED_FIELD");
  return input as Record<string, unknown>;
}
export function parseAccountListInput(input: unknown): AccountListInput {
  const value = object(input, ["approval", "page", "q"]);
  if (
    !approvals.includes(value.approval as AccountApproval) ||
    typeof value.page !== "number" ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    value.page > 1000 ||
    (value.q !== undefined &&
      (typeof value.q !== "string" || /\p{Cc}/u.test(value.q) || value.q.trim().length > 80))
  )
    fail(400, "INVALID_ACCOUNT_QUERY");
  return {
    approval: value.approval as AccountApproval,
    page: value.page,
    q: typeof value.q === "string" ? value.q.trim() : "",
  };
}
function updateInput(input: unknown) {
  const value = object(input, ["name", "locale", "appearance", "expectedAppearance"]);
  if (Object.keys(value).length === 0) fail(400, "INVALID_PROFILE");
  if (
    Object.hasOwn(value, "name") &&
    (typeof value.name !== "string" ||
      value.name.trim().length < 1 ||
      value.name.trim().length > 100 ||
      [...value.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
  )
    fail(400, "INVALID_PROFILE");
  if (
    Object.hasOwn(value, "locale") &&
    !["bs", "en", "de", "ar", "tr"].includes(value.locale as string)
  )
    fail(400, "INVALID_PROFILE");
  if (
    Object.hasOwn(value, "appearance") &&
    !["system", "light", "dark"].includes(value.appearance as string)
  )
    fail(400, "INVALID_PROFILE");
  if (
    Object.hasOwn(value, "expectedAppearance") &&
    (!Object.hasOwn(value, "appearance") ||
      !["system", "light", "dark"].includes(value.expectedAppearance as string))
  )
    fail(400, "INVALID_PROFILE");
  return value as {
    name?: string;
    locale?: AccountLocale;
    appearance?: AccountAppearance;
    expectedAppearance?: AccountAppearance;
  };
}
async function profile(client: Pick<PoolClient, "query">, id: string): Promise<SafeAccountProfile> {
  const result = await client.query<SafeAccountProfile>(
    `SELECT ${profileColumns} FROM ${profileJoin} WHERE u.id = $1`,
    [id],
  );
  if (!result.rows[0]) fail(404, "ACCOUNT_NOT_FOUND");
  return result.rows[0];
}
export async function accountTransaction<T>(
  pool: Pool,
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  }
  let begun = false;
  let discard = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    begun = true;
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL statement_timeout = '2s'");
    const result = await body(client);
    await client.query("COMMIT");
    begun = false;
    return result;
  } catch (error) {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    if (error instanceof AccountAccessError) throw error;
    throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  } finally {
    client.release(discard);
  }
}

export function createAccountAccess(auth: AuthService) {
  async function session(headers: Headers) {
    const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
    if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      fail(400, "INVALID_PROFILE");
    try {
      const result = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!result?.session || result.session.userId !== result.user.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return { ...result.session, expectedAccountId };
    } catch (error) {
      if (error instanceof AccountAccessError) throw error;
      throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
    }
  }
  async function authority(
    client: PoolClient,
    current: Awaited<ReturnType<typeof session>>,
    owner = false,
    lock: "read" | "write" = "write",
  ) {
    // Independent reads share this lock; a suspension, role change or revoked session still fences them.
    const clause = lock === "read" ? "FOR SHARE" : "FOR UPDATE";
    const result = await client.query<CurrentAuthUser>(
      `SELECT id, name, email, "emailVerified", role, approval FROM auth_user WHERE id = $1 ${clause}`,
      [current.userId],
    );
    const user = result.rows[0];
    eligible(user, owner);
    const signed = await client.query(
      `WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 ${clause}) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()`,
      [current.id, current.userId, current.token],
    );
    if (signed.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
    if (current.expectedAccountId !== null && user.id !== current.expectedAccountId)
      fail(401, "ACCOUNT_IDENTITY_CHANGED");
    return user;
  }
  return { session, authority };
}

export function createAccountService({ auth, pool }: { auth: AuthService; pool: Pool }) {
  const { session, authority } = createAccountAccess(auth);
  async function read(headers: Headers): Promise<SafeAccountProfile> {
    const current = await session(headers);
    return accountTransaction(pool, async (client) => {
      const user = await authority(client, current, false, "read");
      return profile(client, user.id);
    });
  }
  return {
    read,
    async changePassword(headers: Headers, input: unknown): Promise<void> {
      const { currentPassword, newPassword } = object(input, ["currentPassword", "newPassword"]);
      const { password } = await auth.$context;
      if (
        typeof currentPassword !== "string" ||
        !currentPassword.length ||
        currentPassword.length > password.config.maxPasswordLength ||
        typeof newPassword !== "string" ||
        newPassword.length < password.config.minPasswordLength ||
        newPassword.length > password.config.maxPasswordLength
      )
        fail(400, "INVALID_PASSWORD_LENGTH");
      if (newPassword.normalize("NFKC") === currentPassword.normalize("NFKC"))
        fail(400, "PASSWORD_UNCHANGED");
      const current = await session(headers);
      if (!current.expectedAccountId) fail(401, "ACCOUNT_IDENTITY_CHANGED");
      const limitKey = `account-password:${current.userId}`;
      const credential = await accountTransaction(pool, async (client) => {
        const user = await authority(client, current, false, "read");
        // Commit failed attempts, with one bounded window per account across devices and instances.
        const attempt = await countAttempt(client, limitKey, { windowSeconds: 60, max: 5 });
        if (!attempt.allowed) fail(429, "TOO_MANY_REQUESTS");
        return (
          await client.query<{ id: string; password: string | null }>(
            'SELECT id,password FROM auth_account WHERE "userId"=$1 AND "providerId"=\'credential\'',
            [user.id],
          )
        ).rows[0];
      });
      if (
        !credential?.password ||
        !(await password.verify({ hash: credential.password, password: currentPassword }))
      )
        fail(400, "INVALID_CURRENT_PASSWORD");
      // Hash off the database connection, then commit only if the session and old credential still match.
      const hash = await password.hash(newPassword);
      await accountTransaction(pool, async (client) => {
        const user = await authority(client, current);
        const updated = await client.query(
          'UPDATE auth_account SET password=$2, "updatedAt"=now() WHERE id=$1 AND "userId"=$3 AND password=$4',
          [credential.id, hash, user.id, credential.password],
        );
        if (updated.rowCount !== 1) fail(400, "INVALID_CURRENT_PASSWORD");
        await client.query('DELETE FROM auth_session WHERE "userId"=$1 AND id<>$2', [
          user.id,
          current.id,
        ]);
        await client.query(
          "DELETE FROM auth_verification WHERE value=$1 AND identifier LIKE 'reset-password:%'",
          [user.id],
        );
        await clearAttempts(client, limitKey);
      });
    },
    async overview(headers: Headers) {
      const current = await session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await authority(client, current, false, "read");
        return readOwnerOverview(client, actor.id);
      });
    },
    async businessToday(headers: Headers, selected: string | null) {
      const current = await session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await authority(client, current, false, "read");
        const value = await readBusinessToday(client, actor.id, selected);
        if (!value) fail(404, "BUSINESS_NOT_FOUND");
        return value;
      });
    },
    async update(headers: Headers, input: unknown): Promise<SafeAccountProfile> {
      const value = updateInput(input),
        current = await session(headers);
      return accountTransaction(pool, async (client) => {
        const user = await authority(client, current);
        if (
          value.expectedAppearance !== undefined &&
          (await profile(client, user.id)).appearance !== value.expectedAppearance
        )
          fail(409, "APPEARANCE_CONFLICT");
        if (value.name !== undefined) {
          await client.query('UPDATE auth_user SET name = $1, "updatedAt" = now() WHERE id = $2', [
            value.name.trim(),
            user.id,
          ]);
          const bumped = await client.query(
            "INSERT INTO personal_profile(user_id,version) VALUES($1,1) ON CONFLICT(user_id) DO UPDATE SET version=personal_profile.version+1,updated_at=now() WHERE personal_profile.version<2147483647 RETURNING version",
            [user.id],
          );
          if (bumped.rowCount !== 1) fail(409, "VERSION_CONFLICT");
        }
        if (value.locale !== undefined || value.appearance !== undefined) {
          await client.query(
            "INSERT INTO auth_account_preferences (user_id, locale, appearance) VALUES ($1, COALESCE($2, 'bs'), COALESCE($3, 'system')) ON CONFLICT (user_id) DO UPDATE SET locale = COALESCE($2, auth_account_preferences.locale), appearance = COALESCE($3, auth_account_preferences.appearance), updated_at = now()",
            [user.id, value.locale ?? null, value.appearance ?? null],
          );
        }
        return profile(client, user.id);
      });
    },
    async adminToday(headers: Headers) {
      const current = await session(headers);
      if (!current.expectedAccountId) fail(401, "ACCOUNT_IDENTITY_CHANGED");
      return accountTransaction(pool, async (client) => {
        await authority(client, current, true, "read");
        return readAdminTodayQueues(client);
      });
    },
    async listPending(headers: Headers) {
      const current = await session(headers);
      return accountTransaction(pool, async (client) => {
        await authority(client, current, true);
        const result = await client.query<SafeAccountProfile>(
          `SELECT ${profileColumns} FROM ${profileJoin} WHERE u.approval = 'pending' ORDER BY u."createdAt", u.id LIMIT 101`,
        );
        return {
          accounts: result.rows.slice(0, 100),
          truncated: result.rows.length > 100,
          limit: 100 as const,
        };
      });
    },
    async listAccounts(
      headers: Headers,
      input: unknown,
      readyOnly = false,
    ): Promise<AccountListPage> {
      const value = parseAccountListInput(input);
      const current = await session(headers);
      return accountTransaction(pool, async (client) => {
        await authority(client, current, true);
        const pattern = value.q ? `%${value.q.replace(/[!%_]/g, "!$&")}%` : null;
        const result = await client.query<SafeAccountProfile>(
          `SELECT ${profileColumns} FROM ${profileJoin} WHERE u.erased_at IS NULL AND u.approval=$1 AND (NOT $4::boolean OR (u.role='member' AND u."emailVerified" AND u.approval='pending')) AND ($2::text IS NULL OR u.name ILIKE $2 ESCAPE '!' OR u.email ILIKE $2 ESCAPE '!') ORDER BY u."createdAt",u.id LIMIT 31 OFFSET $3`,
          [value.approval, pattern, (value.page - 1) * 30, readyOnly],
        );
        return {
          accounts: result.rows.slice(0, 30),
          approval: value.approval,
          page: value.page,
          hasMore: result.rows.length > 30,
          limit: 30,
        };
      });
    },
    async decide(headers: Headers, targetId: string, input: unknown): Promise<SafeAccountProfile> {
      const value = object(input, ["approval", "expected"]);
      if (
        !["approved", "suspended"].includes(value.approval as string) ||
        !approvals.includes(value.expected as AccountApproval) ||
        typeof targetId !== "string" ||
        targetId.length < 1 ||
        targetId.length > 128
      )
        fail(400, "INVALID_DECISION");
      const current = await session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await authority(client, current, true);
        const target = (
          await client.query<CurrentAuthUser>(
            'SELECT id, name, email, "emailVerified", role, approval FROM auth_user WHERE id=$1 AND erased_at IS NULL FOR UPDATE',
            [targetId],
          )
        ).rows[0];
        if (!target) fail(404, "ACCOUNT_NOT_FOUND");
        if (target.role === "owner" || actor.id === target.id) fail(403, "OWNER_TARGET_FORBIDDEN");
        if (target.approval !== value.expected) fail(409, "APPROVAL_CONFLICT");
        if (target.approval === value.approval) return profile(client, target.id);
        if (value.approval === "approved" && !target.emailVerified) fail(409, "EMAIL_NOT_VERIFIED");
        await client.query(
          'UPDATE auth_user SET approval = $1, "updatedAt" = now() WHERE id = $2 AND approval = $3',
          [value.approval, target.id, value.expected],
        );
        await client.query('DELETE FROM auth_session WHERE "userId" = $1', [target.id]);
        const decisionId = randomUUID();
        await client.query(
          "INSERT INTO auth_account_audit (id, actor_user_id, target_user_id, action, previous_approval, next_approval, previous_role, next_role) VALUES ($1, $2, $3, 'approval', $4, $5, $6, $6)",
          [decisionId, actor.id, target.id, target.approval, value.approval, target.role],
        );
        if (value.approval === "approved") {
          await client.query(
            `INSERT INTO account_approval_email(user_id, decision_id) VALUES ($1, $2)
             ON CONFLICT(user_id) DO UPDATE SET decision_id = EXCLUDED.decision_id,
                 failures = 0, next_attempt_at = now(), claim_id = NULL, accepted_at = NULL`,
            [target.id, decisionId],
          );
        } else {
          await client.query("DELETE FROM account_approval_email WHERE user_id = $1", [target.id]);
        }
        return profile(client, target.id);
      });
    },
  };
}

/** Explicit operator call only: promotes an already verified account when no owner exists. */
export async function bootstrapInitialOwner(
  pool: Pool,
  email: string,
): Promise<SafeAccountProfile> {
  try {
    return await bootstrapInitialOwnerRecord(pool, email);
  } catch (error) {
    if (error instanceof InitialOwnerError) throw new AccountAccessError(error.status, error.code);
    throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  }
}

export type AccountService = ReturnType<typeof createAccountService>;
let accountService: AccountService | undefined;
export function getAccountService(): AccountService | null {
  if (accountService) return accountService;
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return null;
  accountService = createAccountService({ auth, pool });
  return accountService;
}
