import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { type AuthService, getAuthService } from "../auth";
import { AccountAccessError, type AccountService, getAccountService } from "../auth/accounts";
import { type CurrentAuthUser, getAuthDatabasePool } from "../auth/service";
import {
  columnMap,
  columns,
  createPublicDirectoryService,
  dto,
  listDirectory,
  type Row,
} from "./read-service";
import {
  type BusinessFields,
  type BusinessStatus,
  DirectoryAccessError,
  type DirectoryBusiness,
  type DirectoryCategory,
  fail,
} from "./types";
import {
  businessInput,
  businessKeys,
  completeFields,
  expectedVersion,
  object,
  text,
  uuid,
  versionInput,
} from "./validation";

function fields(value: DirectoryBusiness): BusinessFields {
  return Object.fromEntries(businessKeys.map((key) => [key, value[key]])) as BusinessFields;
}
function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (user.emailVerified !== true) fail(403, "EMAIL_NOT_VERIFIED");
  if (!["member", "owner"].includes(user.role)) fail(403, "ACCOUNT_ACCESS_DENIED");
}
function owner(user: CurrentAuthUser): void {
  if (user.role !== "owner") fail(403, "OWNER_REQUIRED");
}
async function safe<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DirectoryAccessError) throw error;
    if (error instanceof AccountAccessError)
      throw new DirectoryAccessError(error.status, error.code);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["23505", "23503"].includes(String(error.code))
    )
      fail(409, "CATEGORY_CONFLICT");
    throw new DirectoryAccessError(503, "DIRECTORY_UNAVAILABLE");
  }
}
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  return safe(async () => {
    const client = await pool.connect();
    let begun = false;
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      begun = true;
      await client.query("SET LOCAL lock_timeout = '1s'");
      await client.query("SET LOCAL statement_timeout = '2s'");
      const result = await action(client);
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
type DirectoryIdentity = CurrentAuthUser & {
  session: { id: string; userId: string; token: string };
};
async function lockUsers(client: PoolClient, identity: DirectoryIdentity, extraId?: string) {
  const actorId = identity.id;
  const ids = [...new Set([actorId, ...(extraId ? [extraId] : [])])].sort();
  const result = await client.query<CurrentAuthUser>(
    'SELECT id, name, email, "emailVerified", role, approval FROM auth_user WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
    [ids],
  );
  const actor = result.rows.find((row) => row.id === actorId);
  eligible(actor);
  const session = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [identity.session.id, actorId, identity.session.token],
  );
  if (session.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  return { actor, businessOwner: result.rows.find((row) => row.id === (extraId ?? actorId)) };
}
async function classify(client: PoolClient, value: BusinessFields): Promise<void> {
  const ids = [value.categoryId, ...(value.subcategoryId ? [value.subcategoryId] : [])];
  const result = await client.query<{ id: string; parent_id: string | null }>(
    "SELECT id, parent_id FROM directory_category WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [ids],
  );
  const category = result.rows.find((row) => row.id === value.categoryId);
  const subcategory = value.subcategoryId
    ? result.rows.find((row) => row.id === value.subcategoryId)
    : null;
  if (
    !category ||
    category.parent_id !== null ||
    (value.subcategoryId && (!subcategory || subcategory.parent_id !== category.id))
  )
    fail(409, "CATEGORY_CONFLICT");
}
async function business(client: Pick<PoolClient, "query">, id: string): Promise<DirectoryBusiness> {
  const result = await client.query<Row>(
    `SELECT ${columns} FROM directory_business b WHERE b.id = $1`,
    [id],
  );
  if (!result.rows[0]) fail(404, "BUSINESS_NOT_FOUND");
  return dto(result.rows[0]);
}
async function lockedBusiness(client: PoolClient, identity: DirectoryIdentity, id: string) {
  const actorId = identity.id;
  const hint = (
    await client.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM directory_business WHERE id = $1",
      [id],
    )
  ).rows[0];
  if (!hint) fail(404, "BUSINESS_NOT_FOUND");
  const users = await lockUsers(client, identity, hint.owner_user_id);
  const result = await client.query<Row>(
    `SELECT ${columns} FROM directory_business b WHERE b.id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (row && row.ownerId !== hint.owner_user_id) fail(409, "VERSION_CONFLICT");
  if (!row || (users.actor.role !== "owner" && row.ownerId !== actorId))
    fail(404, "BUSINESS_NOT_FOUND");
  return { ...users, before: dto(row) };
}
function current(before: DirectoryBusiness, expected: number): void {
  if (before.version !== expected) fail(409, "VERSION_CONFLICT");
  if (before.version >= 2147483647) fail(409, "VERSION_EXHAUSTED");
}
function editable(before: DirectoryBusiness): void {
  if (before.status === "archived") fail(409, "BUSINESS_ARCHIVED");
}
async function quota(
  client: PoolClient,
  user: CurrentAuthUser | undefined,
  limit: number,
): Promise<void> {
  if (!user) fail(404, "ACCOUNT_NOT_FOUND");
  if (user.role === "owner") return;
  const count = (
    await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM directory_business WHERE owner_user_id = $1 AND status <> 'archived'",
      [user.id],
    )
  ).rows[0]?.count;
  if (count === undefined || count >= limit) fail(409, "BUSINESS_LIMIT_REACHED");
}
async function save(
  client: PoolClient,
  before: DirectoryBusiness,
  value: BusinessFields,
  status: BusinessStatus,
): Promise<DirectoryBusiness> {
  const values: unknown[] = businessKeys.map((key) => value[key]);
  const statusIndex = values.push(status),
    idIndex = values.push(before.id),
    versionIndex = values.push(before.version);
  const assignments = businessKeys.map((key, index) => `${columnMap[key]} = $${index + 1}`);
  const result = await client.query<Row>(
    `UPDATE directory_business b SET ${assignments.join(", ")}, status = $${statusIndex}, version = version + 1, updated_at = now(), published_at = CASE WHEN $${statusIndex} = 'published' THEN COALESCE(published_at, now()) WHEN $${statusIndex} = 'archived' THEN published_at ELSE NULL END, archived_at = CASE WHEN $${statusIndex} = 'archived' THEN now() ELSE NULL END WHERE b.id = $${idIndex} AND b.version = $${versionIndex} RETURNING ${columns}`,
    values,
  );
  if (!result.rows[0]) fail(409, "VERSION_CONFLICT");
  return dto(result.rows[0]);
}
async function audit(
  client: PoolClient,
  actorId: string,
  before: DirectoryBusiness,
  after: DirectoryBusiness,
  action: "publish" | "moderate" | "owner-update",
  reason: string | null = null,
) {
  await client.query(
    "INSERT INTO directory_moderation_audit (id, actor_user_id, business_id, action, previous_status, next_status, previous_version, next_version, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      actorId,
      before.id,
      action,
      before.status,
      after.status,
      before.version,
      after.version,
      reason,
    ],
  );
}

export function createDirectoryService({
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
    fail(503, "DIRECTORY_CONFIGURATION_INVALID");
  const actor = (headers: Headers) =>
    safe(async () => {
      const value = await accounts.read(headers);
      eligible(value);
      const signed = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!signed?.session || signed.session.userId !== value.id || signed.user.id !== value.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return { ...value, session: signed.session };
    });
  const list = (input: unknown, condition: string, parameters: unknown[], publicOnly = false) =>
    listDirectory(pool, input, condition, parameters, publicOnly);
  return {
    ...createPublicDirectoryService({ database: pool }),
    async createCategory(headers: Headers, input: unknown): Promise<DirectoryCategory> {
      const value = object(input, ["name", "slug", "parentId"]);
      const name = text(value.name, 80),
        slug = text(value.slug, 80),
        parentId =
          value.parentId === undefined || value.parentId === null ? null : uuid(value.parentId);
      if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400, "INVALID_DIRECTORY_INPUT");
      const identity = await actor(headers);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await lockUsers(client, identity);
        owner(currentActor);
        if (parentId) {
          const parent = (
            await client.query<{ parent_id: string | null }>(
              "SELECT parent_id FROM directory_category WHERE id = $1 FOR SHARE",
              [parentId],
            )
          ).rows[0];
          if (!parent || parent.parent_id !== null) fail(409, "CATEGORY_CONFLICT");
        }
        return (
          await client.query<DirectoryCategory>(
            'INSERT INTO directory_category (id,name,slug,parent_id) VALUES ($1,$2,$3,$4) RETURNING id,name,slug,parent_id AS "parentId"',
            [randomUUID(), name, slug, parentId],
          )
        ).rows[0] as DirectoryCategory;
      });
    },
    async listOwn(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers);
      return safe(() => list(input, "b.owner_user_id = $1", [identity.id]));
    },
    async listAdmin(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers);
      owner(identity);
      return safe(() => list(input, "true", []));
    },
    async pending(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers);
      owner(identity);
      object(input, ["page", "pageSize"]);
      return safe(() => list(input, "b.status = 'pending'", []));
    },
    async readOwn(headers: Headers, id: string) {
      const identity = await actor(headers),
        key = uuid(id);
      return safe(async () => {
        const value = await business(pool, key);
        if (value.ownerId !== identity.id && identity.role !== "owner")
          fail(404, "BUSINESS_NOT_FOUND");
        return value;
      });
    },
    async create(headers: Headers, input: unknown, requestId: string): Promise<DirectoryBusiness> {
      const value = completeFields(businessInput(input, true) as BusinessFields),
        operation = uuid(requestId);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(businessKeys.map((key) => value[key])))
        .digest("hex");
      const identity = await actor(headers);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await lockUsers(client, identity);
        const replay = (
          await client.query<{ fingerprint: string; business_id: string }>(
            "SELECT fingerprint,business_id FROM directory_create_commands WHERE actor_user_id = $1 AND request_id = $2",
            [currentActor.id, operation],
          )
        ).rows[0];
        if (replay) {
          if (replay.fingerprint !== fingerprint) fail(409, "IDEMPOTENCY_CONFLICT");
          return business(client, replay.business_id);
        }
        await quota(client, currentActor, memberBusinessLimit);
        await classify(client, value);
        const id = randomUUID(),
          values = [id, currentActor.id, ...businessKeys.map((key) => value[key])];
        const names = ["id", "owner_user_id", ...businessKeys.map((key) => columnMap[key])];
        await client.query(
          `INSERT INTO directory_business (${names.join(",")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(",")})`,
          values,
        );
        await client.query(
          "INSERT INTO directory_create_commands (actor_user_id,request_id,fingerprint,business_id) VALUES ($1,$2,$3,$4)",
          [currentActor.id, operation, fingerprint, id],
        );
        return business(client, id);
      });
    },
    async update(headers: Headers, id: string, input: unknown) {
      const value = businessInput(input, false),
        identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const { actor: currentActor, before } = await lockedBusiness(client, identity, key);
        current(before, value.expectedVersion as number);
        editable(before);
        const { expectedVersion: _version, ...patch } = value;
        const next = completeFields({ ...fields(before), ...patch });
        await classify(client, next);
        const status =
          currentActor.role === "member" && before.status === "published"
            ? "pending"
            : before.status;
        const after = await save(client, before, next, status);
        if (currentActor.role === "owner" && before.status === "published")
          await audit(client, currentActor.id, before, after, "owner-update");
        return after;
      });
    },
    async publish(headers: Headers, id: string, input: unknown) {
      const expected = versionInput(input),
        identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const {
          actor: currentActor,
          businessOwner,
          before,
        } = await lockedBusiness(client, identity, key);
        current(before, expected);
        editable(before);
        eligible(businessOwner);
        await classify(client, fields(before));
        const status = currentActor.role === "owner" ? "published" : "pending";
        if (before.status === status) return before;
        const after = await save(client, before, fields(before), status);
        if (currentActor.role === "owner")
          await audit(client, currentActor.id, before, after, "publish");
        return after;
      });
    },
    async archive(headers: Headers, id: string, input: unknown) {
      const expected = versionInput(input),
        identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const { before } = await lockedBusiness(client, identity, key);
        current(before, expected);
        if (before.status === "archived") return before;
        return save(client, before, fields(before), "archived");
      });
    },
    async recover(headers: Headers, id: string, input: unknown) {
      const expected = versionInput(input),
        identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const { businessOwner, before } = await lockedBusiness(client, identity, key);
        current(before, expected);
        if (before.status !== "archived") fail(409, "BUSINESS_NOT_ARCHIVED");
        await quota(client, businessOwner, memberBusinessLimit);
        await classify(client, fields(before));
        return save(client, before, fields(before), "draft");
      });
    },
    async moderate(headers: Headers, id: string, input: unknown) {
      const value = object(input, ["status", "expectedVersion", "reason"]),
        expected = expectedVersion(value.expectedVersion);
      if (!["published", "draft"].includes(value.status as string))
        fail(400, "INVALID_DIRECTORY_INPUT");
      const reason = value.reason === undefined ? null : text(value.reason, 500, true);
      if (value.status === "draft" && (!reason || reason.length < 2))
        fail(400, "INVALID_DIRECTORY_INPUT");
      const identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const {
          actor: currentActor,
          businessOwner,
          before,
        } = await lockedBusiness(client, identity, key);
        owner(currentActor);
        current(before, expected);
        editable(before);
        if (value.status === "published") {
          eligible(businessOwner);
          await classify(client, fields(before));
        }
        if (before.status === value.status) return before;
        const after = await save(
          client,
          before,
          fields(before),
          value.status as "published" | "draft",
        );
        await audit(client, currentActor.id, before, after, "moderate", reason);
        return after;
      });
    },
  };
}

export type DirectoryService = ReturnType<typeof createDirectoryService>;
let directoryService: DirectoryService | undefined;
export function getDirectoryService(): DirectoryService | null {
  if (directoryService) return directoryService;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  const raw = process.env.DIRECTORY_MEMBER_BUSINESS_LIMIT;
  if (raw !== undefined && !/^\d+$/.test(raw)) fail(503, "DIRECTORY_CONFIGURATION_INVALID");
  directoryService = createDirectoryService({
    accounts,
    auth,
    pool,
    memberBusinessLimit: raw === undefined ? 1 : Number(raw),
  });
  return directoryService;
}
