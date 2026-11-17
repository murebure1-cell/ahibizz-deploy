import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  OwnershipLookup,
  OwnershipPerson,
  OwnershipReceipt,
  OwnershipSnapshot,
} from "../../lib/business-ownership";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import { columns, dto, type Row } from "../directory/read-service";
import { DirectoryAccessError } from "../directory/types";
import {
  accountId,
  commandInput,
  email,
  fail,
  lookupInput,
  OwnershipAccessError,
  uuid,
} from "./validation";

type Session = { id: string; userId: string; token: string; expectedAccountId: string | null };
type ReceiptRow = Omit<OwnershipReceipt, "recordedAt"> & { fingerprint: string; recordedAt: Date };
const userColumns = 'id,name,email,"emailVerified",role,approval';
const receiptColumns =
  'request_id AS "requestId",business_id AS "businessId",previous_owner_user_id AS "previousOwnerId",target_user_id AS "targetAccountId",previous_version AS "previousVersion",result_version AS "resultVersion",created_at AS "recordedAt",fingerprint';
function person(user: CurrentAuthUser): OwnershipPerson {
  return { id: user.id, name: user.name, email: user.email };
}
function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (!user.emailVerified) fail(403, "EMAIL_NOT_VERIFIED");
  if (!["member", "owner"].includes(user.role)) fail(403, "ACCOUNT_ACCESS_DENIED");
}
function admin(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  eligible(user);
  if (user.role !== "owner") fail(403, "OWNER_REQUIRED");
}
function targetEligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(404, "TARGET_ACCOUNT_NOT_FOUND");
  if (
    !user.emailVerified ||
    user.approval !== "approved" ||
    !["member", "owner"].includes(user.role)
  )
    fail(409, "TARGET_ACCOUNT_NOT_ELIGIBLE");
}
async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof OwnershipAccessError) throw error;
    if (error instanceof AccountAccessError || error instanceof DirectoryAccessError)
      throw new OwnershipAccessError(error.status, error.code);
    throw new OwnershipAccessError(503, "OWNERSHIP_UNAVAILABLE");
  }
}
async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  return safe(async () => {
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
      if (begun) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      }
      throw error;
    } finally {
      client.release(discard);
    }
  });
}
function receiptDto(row: ReceiptRow): OwnershipReceipt {
  return {
    requestId: row.requestId,
    businessId: row.businessId,
    previousOwnerId: row.previousOwnerId,
    targetAccountId: row.targetAccountId,
    previousVersion: row.previousVersion,
    resultVersion: row.resultVersion,
    recordedAt: row.recordedAt.toISOString(),
  };
}
async function receipt(client: PoolClient, actor: string, requestId: string) {
  return (
    (
      await client.query<ReceiptRow>(
        `SELECT ${receiptColumns} FROM directory_ownership_transfer WHERE actor_user_id=$1 AND request_id=$2`,
        [actor, requestId],
      )
    ).rows[0] ?? null
  );
}
async function freshSession(client: PoolClient, signed: Session) {
  const fresh = await client.query(
    'WITH locked AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked WHERE "expiresAt">clock_timestamp()',
    [signed.id, signed.userId, signed.token],
  );
  if (fresh.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
}
async function context(client: PoolClient, signed: Session, id: string, targetId?: string) {
  const hint = (
    await client.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM directory_business WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!hint) fail(404, "BUSINESS_NOT_FOUND");
  const ids = [
    ...new Set([signed.userId, hint.owner_user_id, ...(targetId ? [targetId] : [])]),
  ].sort();
  const users = (
    await client.query<CurrentAuthUser>(
      `SELECT ${userColumns} FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [ids],
    )
  ).rows;
  const actor = users.find((user) => user.id === signed.userId);
  admin(actor);
  if (signed.expectedAccountId !== null && signed.expectedAccountId !== actor.id)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  await freshSession(client, signed);
  const row = (
    await client.query<Row>(
      `SELECT ${columns} FROM directory_business b WHERE b.id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "BUSINESS_NOT_FOUND");
  if (row.ownerId !== hint.owner_user_id) fail(409, "VERSION_CONFLICT");
  // The business-row wait may outlive the signed session even when the session
  // row was locked earlier. Recheck the actual wall clock after the final wait.
  await freshSession(client, signed);
  const currentOwner = users.find((user) => user.id === row.ownerId);
  if (!currentOwner) fail(503, "OWNERSHIP_UNAVAILABLE");
  return { actor, users, business: dto(row), currentOwner: person(currentOwner) };
}
export function createBusinessOwnershipService({
  accounts,
  auth,
  pool,
  memberBusinessLimit = 1,
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
  memberBusinessLimit?: number;
}) {
  if (
    !Number.isInteger(memberBusinessLimit) ||
    memberBusinessLimit < 1 ||
    memberBusinessLimit > 100
  )
    fail(503, "OWNERSHIP_CONFIGURATION_INVALID");
  async function session(headers: Headers): Promise<Session> {
    return safe(async () => {
      const expected = headers.get("X-AhiBizz-Account-ID");
      if (expected !== null) accountId(expected);
      const identity = await accounts.read(headers);
      admin(identity);
      const signed = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (
        !signed?.session ||
        signed.session.userId !== identity.id ||
        signed.user.id !== identity.id
      )
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        id: signed.session.id,
        userId: identity.id,
        token: signed.session.token,
        expectedAccountId: expected,
      };
    });
  }
  async function authenticate(headers: Headers) {
    const signed = await session(headers);
    return transaction(pool, async (client) => {
      const actor = (
        await client.query<CurrentAuthUser>(
          `SELECT ${userColumns} FROM auth_user WHERE id=$1 FOR UPDATE`,
          [signed.userId],
        )
      ).rows[0];
      admin(actor);
      if (signed.expectedAccountId !== null && signed.expectedAccountId !== actor.id)
        fail(401, "ACCOUNT_IDENTITY_CHANGED");
      const fresh = await client.query(
        'WITH locked AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked WHERE "expiresAt">clock_timestamp()',
        [signed.id, actor.id, signed.token],
      );
      if (fresh.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
      return actor.id;
    });
  }
  return {
    authenticate,
    async read(
      headers: Headers,
      businessId: string,
      requestId?: string,
    ): Promise<OwnershipSnapshot> {
      const signed = await session(headers),
        id = uuid(businessId),
        key = requestId === undefined ? null : uuid(requestId);
      return transaction(pool, async (client) => {
        const state = await context(client, signed, id);
        const prior = key ? await receipt(client, state.actor.id, key) : null;
        if (prior && prior.businessId !== id) fail(409, "IDEMPOTENCY_CONFLICT");
        return {
          business: state.business,
          currentOwner: state.currentOwner,
          receipt: prior ? receiptDto(prior) : null,
        };
      });
    },
    async lookup(headers: Headers, businessId: string, input: unknown): Promise<OwnershipLookup> {
      const signed = await session(headers),
        id = uuid(businessId),
        normalized = lookupInput(input);
      return transaction(pool, async (client) => {
        const hint = (
          await client.query<{ id: string }>("SELECT id FROM auth_user WHERE lower(email)=$1", [
            normalized,
          ])
        ).rows[0];
        const state = await context(client, signed, id, hint?.id);
        const target = hint ? state.users.find((user) => user.id === hint.id) : undefined;
        targetEligible(target);
        if (email(target.email) !== normalized) fail(409, "TARGET_ACCOUNT_CHANGED");
        if (target.id === state.business.ownerId) fail(409, "BUSINESS_OWNER_UNCHANGED");
        return {
          business: state.business,
          currentOwner: state.currentOwner,
          receipt: null,
          candidate: person(target),
        };
      });
    },
    async assign(headers: Headers, businessId: string, input: unknown): Promise<OwnershipSnapshot> {
      const signed = await session(headers),
        id = uuid(businessId),
        value = commandInput(input);
      const intent = createHash("sha256")
        .update(
          JSON.stringify([
            1,
            id,
            value.expectedVersion,
            value.targetAccountId,
            value.targetEmail,
            value.note,
          ]),
        )
        .digest("hex");
      return transaction(pool, async (client) => {
        const state = await context(client, signed, id, value.targetAccountId);
        const prior = await receipt(client, state.actor.id, value.idempotencyKey);
        if (prior) {
          if (prior.fingerprint !== intent || prior.businessId !== id)
            fail(409, "IDEMPOTENCY_CONFLICT");
          return {
            business: state.business,
            currentOwner: state.currentOwner,
            receipt: receiptDto(prior),
          };
        }
        if (state.business.version !== value.expectedVersion) fail(409, "VERSION_CONFLICT");
        const target = state.users.find((user) => user.id === value.targetAccountId);
        targetEligible(target);
        if (email(target.email) !== value.targetEmail) fail(409, "TARGET_ACCOUNT_CHANGED");
        if (target.id === state.business.ownerId) fail(409, "BUSINESS_OWNER_UNCHANGED");
        if (state.business.status !== "archived" && target.role !== "owner") {
          const count = (
            await client.query<{ n: number }>(
              "SELECT count(*)::integer AS n FROM directory_business WHERE owner_user_id=$1 AND status<>'archived'",
              [target.id],
            )
          ).rows[0]?.n;
          if (count === undefined || count >= memberBusinessLimit)
            fail(409, "BUSINESS_LIMIT_REACHED");
        }
        const changed = await client.query(
          "UPDATE directory_business SET owner_user_id=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND version=$3",
          [target.id, id, value.expectedVersion],
        );
        if (changed.rowCount !== 1) fail(409, "VERSION_CONFLICT");
        const created = (
          await client.query<ReceiptRow>(
            `INSERT INTO directory_ownership_transfer(actor_user_id,request_id,business_id,previous_owner_user_id,target_user_id,previous_version,result_version,fingerprint,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${receiptColumns}`,
            [
              state.actor.id,
              value.idempotencyKey,
              id,
              state.business.ownerId,
              target.id,
              value.expectedVersion,
              value.expectedVersion + 1,
              intent,
              value.note || null,
            ],
          )
        ).rows[0];
        if (!created) fail(503, "OWNERSHIP_UNAVAILABLE");
        const row = (
          await client.query<Row>(`SELECT ${columns} FROM directory_business b WHERE b.id=$1`, [id])
        ).rows[0];
        if (!row) fail(503, "OWNERSHIP_UNAVAILABLE");
        return { business: dto(row), currentOwner: person(target), receipt: receiptDto(created) };
      });
    },
  };
}
export type BusinessOwnershipService = ReturnType<typeof createBusinessOwnershipService>;
let singleton: BusinessOwnershipService | undefined;
export function getBusinessOwnershipService(): BusinessOwnershipService | null {
  if (singleton) return singleton;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  const raw = process.env.DIRECTORY_MEMBER_BUSINESS_LIMIT;
  if (raw !== undefined && !/^\d+$/.test(raw)) fail(503, "OWNERSHIP_CONFIGURATION_INVALID");
  singleton = createBusinessOwnershipService({
    accounts,
    auth,
    pool,
    memberBusinessLimit: raw === undefined ? 1 : Number(raw),
  });
  return singleton;
}
