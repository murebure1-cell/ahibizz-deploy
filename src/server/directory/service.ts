import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type BusinessDetails,
  emptyBusinessDetails,
  readBusinessDetails,
} from "../../lib/business-details";
import { type AuthService, getAuthService } from "../auth";
import { AccountAccessError, type AccountService, getAccountService } from "../auth/accounts";
import { type CurrentAuthUser, getAuthDatabasePool } from "../auth/service";
import {
  applyBusinessImageProposals,
  clearBusinessImageProposals,
} from "../business-media/proposals";
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
  expectedAccountId?: string;
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
  if (identity.expectedAccountId !== undefined && actor.id !== identity.expectedAccountId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
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
    `SELECT ${columns} FROM directory_business b WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [id],
  );
  if (!result.rows[0]) fail(404, "BUSINESS_NOT_FOUND");
  return dto(result.rows[0]);
}
async function lockedBusiness(client: PoolClient, identity: DirectoryIdentity, id: string) {
  const actorId = identity.id;
  const hint = (
    await client.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM directory_business WHERE id = $1 AND deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!hint) fail(404, "BUSINESS_NOT_FOUND");
  const users = await lockUsers(client, identity, hint.owner_user_id);
  const result = await client.query<Row>(
    `SELECT ${columns} FROM directory_business b WHERE b.id = $1 AND b.deleted_at IS NULL FOR UPDATE`,
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
      "SELECT count(*)::integer AS count FROM directory_business b WHERE owner_user_id = $1 AND status <> 'archived' AND (package_access<>'subscription' OR NOT package_allows_listing(b))",
      [user.id],
    )
  ).rows[0]?.count;
  if (count === undefined || count >= limit) fail(409, "BUSINESS_LIMIT_REACHED");
}
async function accessForNewListing(
  client: PoolClient,
  user: CurrentAuthUser,
  limit: number,
  allowPaidDraft: boolean,
): Promise<"legacy" | "first_year" | "subscription"> {
  if (user.role === "owner") return "legacy";
  const { rows } = await client.query<{ previous: number; active: number; unpaid: boolean }>(
    `SELECT count(*)::int AS previous,
       count(*) FILTER (WHERE b.status<>'archived' AND b.package_access<>'subscription')::int AS active,
       coalesce(bool_or(b.status='draft' AND b.package_access='subscription' AND NOT package_allows_listing(b)),false) AS unpaid
     FROM directory_business b WHERE b.owner_user_id=$1`,
    [user.id],
  );
  const usage = rows[0];
  if (!usage) fail(503, "DIRECTORY_UNAVAILABLE");
  if (usage.previous === 0) return "first_year";
  if (limit > 1 && usage.active < limit) return "legacy";
  // Older clients may still create a replacement draft after archiving; it has no new free year.
  if (!allowPaidDraft && usage.active === 0 && !usage.unpaid) return "subscription";
  if (!allowPaidDraft || usage.unpaid) fail(409, "BUSINESS_LIMIT_REACHED");
  return "subscription";
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
type EditorialRevision = NonNullable<DirectoryBusiness["editorialRevision"]>;

async function stageRevision(
  client: PoolClient,
  before: DirectoryBusiness,
  revision: EditorialRevision,
) {
  const payload = Object.keys(revision).length ? JSON.stringify(revision) : null;
  await client.query(
    "UPDATE directory_business SET editorial_revision=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
    [before.id, payload],
  );
  return business(client, before.id);
}

async function saveDetails(
  client: PoolClient,
  id: string,
  details: BusinessDetails,
  version: number,
) {
  await client.query(
    `WITH updated AS (
       UPDATE directory_business_details SET timezone=$2,hours=$3::jsonb,amenities=$4::text[],
         business_version=$5,updated_at=now() WHERE business_id=$1 RETURNING business_id
     )
     INSERT INTO directory_business_details (business_id,timezone,hours,amenities,business_version)
     SELECT $1,$2,$3::jsonb,$4::text[],$5 WHERE NOT EXISTS (SELECT 1 FROM updated)`,
    [
      id,
      details.timezone,
      details.hours === null ? null : JSON.stringify(details.hours),
      details.amenities,
      version,
    ],
  );
}

async function audit(
  client: PoolClient,
  actorId: string,
  before: DirectoryBusiness,
  after: DirectoryBusiness,
  action: "publish" | "moderate" | "owner-update" | "approve-changes" | "reject-changes",
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
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
        fail(400, "INVALID_DIRECTORY_INPUT");
      const value = await accounts.read(headers);
      eligible(value);
      const signed = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!signed?.session || signed.session.userId !== value.id || signed.user.id !== value.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        ...value,
        session: signed.session,
        ...(expectedAccountId === null ? {} : { expectedAccountId }),
      };
    });
  return {
    ...createPublicDirectoryService({ database: pool }),
    async createCategory(headers: Headers, input: unknown): Promise<DirectoryCategory> {
      const value = object(input, ["name", "slug", "parentId", "vehicleRental", "accommodation"]);
      if (
        (value.vehicleRental !== undefined && typeof value.vehicleRental !== "boolean") ||
        (value.accommodation !== undefined && typeof value.accommodation !== "boolean")
      )
        fail(400, "INVALID_DIRECTORY_INPUT");
      const name = text(value.name, 80),
        slug = text(value.slug, 80),
        parentId =
          value.parentId === undefined || value.parentId === null ? null : uuid(value.parentId);
      if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(400, "INVALID_DIRECTORY_INPUT");
      const identity = await actor(headers);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await lockUsers(client, identity);
        owner(currentActor);
        let inheritedRental = false;
        let inheritedAccommodation = false;
        if (parentId) {
          const parent = (
            await client.query<{
              parent_id: string | null;
              vehicle_rental: boolean;
              accommodation: boolean;
            }>(
              "SELECT parent_id, vehicle_rental, accommodation FROM directory_category WHERE id = $1 FOR SHARE",
              [parentId],
            )
          ).rows[0];
          if (!parent || parent.parent_id !== null) fail(409, "CATEGORY_CONFLICT");
          inheritedRental = parent.vehicle_rental;
          inheritedAccommodation = parent.accommodation;
        }
        return (
          await client.query<DirectoryCategory>(
            `INSERT INTO directory_category (id,name,slug,parent_id,vehicle_rental,accommodation) VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING id,name,slug,parent_id AS "parentId",(vehicle_rental OR $7::boolean) AS "vehicleRental", (accommodation OR $8::boolean) AS accommodation`,
            [
              randomUUID(),
              name,
              slug,
              parentId,
              value.vehicleRental ?? false,
              value.accommodation ?? false,
              inheritedRental,
              inheritedAccommodation,
            ],
          )
        ).rows[0] as DirectoryCategory;
      });
    },
    async listOwn(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await lockUsers(client, identity);
        return listDirectory(client, input, "b.owner_user_id = $1", [currentActor.id]);
      });
    },
    async listAdmin(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await lockUsers(client, identity);
        owner(currentActor);
        const { map, ...filters } = object(input, [
          "q",
          "page",
          "pageSize",
          "categoryId",
          "subcategoryId",
          "status",
          "map",
        ]);
        if (map === undefined) return listDirectory(client, filters, "true", []);
        if (map !== "missing" || (filters.status !== undefined && filters.status !== "published"))
          fail(400, "INVALID_DIRECTORY_INPUT");
        return listDirectory(
          client,
          { ...filters, status: "published" },
          "(b.latitude IS NULL OR b.longitude IS NULL)",
          [],
        );
      });
    },
    async pending(headers: Headers, input: unknown = {}) {
      const identity = await actor(headers);
      object(input, ["q", "page", "pageSize"]);
      return transaction(pool, async (client) => {
        const { actor: currentActor } = await lockUsers(client, identity);
        owner(currentActor);
        return listDirectory(
          client,
          input,
          "(b.status='pending' OR b.editorial_revision IS NOT NULL OR EXISTS (SELECT 1 FROM directory_business_image_proposal ip WHERE ip.business_id=b.id))",
          [],
        );
      });
    },
    async readOwn(headers: Headers, id: string) {
      const identity = await actor(headers),
        key = uuid(id);
      return transaction(
        pool,
        async (client) => (await lockedBusiness(client, identity, key)).before,
      );
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
        const packageAccess = await accessForNewListing(
          client,
          currentActor,
          memberBusinessLimit,
          headers.get("X-AhiBizz-Paid-Draft") === "1",
        );
        await classify(client, value);
        const id = randomUUID(),
          values = [id, currentActor.id, packageAccess, ...businessKeys.map((key) => value[key])];
        const names = [
          "id",
          "owner_user_id",
          "package_access",
          ...businessKeys.map((key) => columnMap[key]),
        ];
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
        const reviewing = before.status === "published" && currentActor.role === "member";
        const previous = reviewing
          ? { ...fields(before), ...before.editorialRevision?.fields }
          : fields(before);
        const next = completeFields({ ...previous, ...patch });
        if (businessKeys.every((key) => previous[key] === next[key])) return before;
        await classify(client, next);
        if (reviewing) {
          const revision = { ...before.editorialRevision };
          const differences = Object.fromEntries(
            businessKeys.filter((key) => before[key] !== next[key]).map((key) => [key, next[key]]),
          );
          if (Object.keys(differences).length) revision.fields = differences;
          else delete revision.fields;
          return stageRevision(client, before, revision);
        }
        if (before.editorialRevision?.fields) fail(409, "REVIEW_REQUIRED");
        const after = await save(client, before, next, before.status);
        if (currentActor.role === "owner" && before.status === "published")
          await audit(client, currentActor.id, before, after, "owner-update");
        return after;
      });
    },
    async readDetails(headers: Headers, id: string) {
      const identity = await actor(headers),
        key = uuid(id);
      return transaction(
        pool,
        async (client) => (await lockedBusiness(client, identity, key)).before,
      );
    },
    async updateDetails(headers: Headers, id: string, input: unknown) {
      const raw = object(input, ["expectedVersion", "details"]),
        expected = expectedVersion(raw.expectedVersion);
      let details: BusinessDetails;
      try {
        details = readBusinessDetails(raw.details);
      } catch {
        fail(400, "INVALID_BUSINESS_DETAILS");
      }
      const identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const { actor: currentActor, before } = await lockedBusiness(client, identity, key);
        current(before, expected);
        editable(before);
        const reviewing = before.status === "published" && currentActor.role === "member";
        const approved = readBusinessDetails(before.details ?? emptyBusinessDetails());
        const previous =
          reviewing && before.editorialRevision?.details
            ? readBusinessDetails(before.editorialRevision.details)
            : approved;
        if (JSON.stringify(previous) === JSON.stringify(details)) return before;
        if (reviewing) {
          const revision = { ...before.editorialRevision };
          if (JSON.stringify(approved) === JSON.stringify(details)) delete revision.details;
          else revision.details = details;
          return stageRevision(client, before, revision);
        }
        if (before.editorialRevision?.details) fail(409, "REVIEW_REQUIRED");
        const after = await save(client, before, fields(before), before.status);
        await saveDetails(client, key, details, after.version);
        if (currentActor.role === "owner" && before.status === "published")
          await audit(client, currentActor.id, before, after, "owner-update");
        return business(client, key);
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
        if (before.packagePaymentNeeded) fail(409, "PACKAGE_PAYMENT_REQUIRED");
        await classify(client, fields(before));
        if (before.status === "published") return before;
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
    async remove(headers: Headers, id: string, input: unknown) {
      const expected = versionInput(input),
        identity = await actor(headers),
        key = uuid(id);
      return transaction(pool, async (client) => {
        const { actor: currentActor, before } = await lockedBusiness(client, identity, key);
        current(before, expected);
        // Booking and sales creation take this same business lock before writing.
        const { rows } = await client.query<{
          bookings: boolean;
          contract: boolean;
          payments: boolean;
        }>(
          `SELECT
            (EXISTS (SELECT 1 FROM booking_entry WHERE business_id=$1 AND kind<>'block'
                 AND status IN ('requested','confirmed'))
              OR EXISTS (SELECT 1 FROM rental_booking WHERE business_id=$1 AND kind='customer'
                 AND status IN ('requested','confirmed') AND ends_at>now())
              OR EXISTS (SELECT 1 FROM stay_booking WHERE business_id=$1 AND kind='customer'
                 AND status IN ('requested','confirmed') AND check_out>(now() AT TIME ZONE timezone)::date)) AS bookings,
            (EXISTS (SELECT 1 FROM live_package_contract WHERE business_id=$1 AND
                 ((status NOT IN ('CANCELLED','EXPIRED') AND NOT (payment_method='credits' AND paid_cycles=total_cycles AND ends_at IS NOT NULL AND ends_at<=now())) OR ends_at>now() OR settlement_hold_until>now()))
              OR EXISTS (SELECT 1 FROM billing_receipt WHERE business_id=$1 AND kind='subscription'
                 AND gross_minor>refunded_minor AND service_ends_on>(now() AT TIME ZONE 'Europe/Sarajevo')::date)) AS contract,
            (EXISTS (SELECT 1 FROM marketing_order WHERE business_id=$1 AND
                 (production_receipt_conflict OR
                   (status='paid' AND revoked_at IS NULL AND ends_at>now())))
              OR EXISTS (SELECT 1 FROM wallet_category_promotion w
                 WHERE w.business_id=$1 AND w.revoked_at IS NULL AND w.ends_at>now())
              OR EXISTS (SELECT 1 FROM paypal_promotion_entitlement e
                 JOIN paypal_checkout_order p ON p.id=e.order_id AND p.environment='live'
                 WHERE e.business_id=$1 AND e.revoked_at IS NULL AND e.ends_at>now())
              OR EXISTS (SELECT 1 FROM paypal_checkout_order p
                 LEFT JOIN marketing_order m ON m.id=p.quote_id
                 WHERE (p.business_id=$1 OR m.business_id=$1) AND p.environment='live' AND
                   (p.status='review' OR p.refund_total_unknown OR p.capture_lease_until>now()
                    OR (p.status IN ('created','provider_created') AND p.expires_at>now())
                    OR EXISTS (SELECT 1 FROM paypal_refund_command r WHERE r.order_id=p.id AND r.status='reserved')))) AS payments`,
          [key],
        );
        const obligations = rows[0];
        if (!obligations) fail(503, "DIRECTORY_UNAVAILABLE");
        if (obligations.bookings) fail(409, "BUSINESS_HAS_BOOKINGS");
        if (obligations.contract) fail(409, "BUSINESS_HAS_CONTRACT");
        if (obligations.payments) fail(409, "BUSINESS_HAS_PAYMENTS");
        await clearBusinessImageProposals(client, key);
        await client.query(
          `UPDATE directory_business SET deleted_at=now(), deleted_by=$2, status='archived',
            archived_at=COALESCE(archived_at,now()), editorial_revision=NULL, version=version+1, updated_at=now()
           WHERE id=$1`,
          [key, currentActor.id],
        );
        return { deleted: true as const };
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
        const access = (
          await client.query<{ kind: string; anotherUnpaid: boolean }>(
            `SELECT b.package_access AS kind,
            EXISTS(SELECT 1 FROM directory_business other WHERE other.owner_user_id=b.owner_user_id AND other.id<>b.id
              AND other.status='draft' AND other.package_access='subscription' AND NOT package_allows_listing(other)) AS "anotherUnpaid"
            FROM directory_business b WHERE b.id=$1`,
            [key],
          )
        ).rows[0];
        if (access?.kind === "subscription") {
          if (before.packagePaymentNeeded && access.anotherUnpaid)
            fail(409, "BUSINESS_LIMIT_REACHED");
        } else await quota(client, businessOwner, memberBusinessLimit);
        await classify(client, fields(before));
        return save(client, before, fields(before), "draft");
      });
    },
    async moderate(headers: Headers, id: string, input: unknown) {
      const value = object(input, ["status", "expectedVersion", "reason"]),
        expected = expectedVersion(value.expectedVersion);
      if (
        !["published", "draft", "approve-changes", "reject-changes"].includes(
          value.status as string,
        )
      )
        fail(400, "INVALID_DIRECTORY_INPUT");
      const reason = value.reason === undefined ? null : text(value.reason, 500, true);
      if (
        (value.status === "draft" || value.status === "reject-changes") &&
        (!reason || reason.length < 2)
      )
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
        if (value.status === "approve-changes" || value.status === "reject-changes") {
          if (before.status !== "published" || (!before.editorialRevision && !before.pendingMedia))
            fail(409, "NO_PENDING_CHANGES");
          const approving = value.status === "approve-changes";
          const next = approving
            ? completeFields({ ...fields(before), ...before.editorialRevision?.fields })
            : fields(before);
          if (approving) {
            eligible(businessOwner);
            await classify(client, next);
          }
          await client.query("UPDATE directory_business SET editorial_revision=NULL WHERE id=$1", [
            key,
          ]);
          const after = await save(client, before, next, "published");
          if (approving) {
            if (before.editorialRevision?.details)
              await saveDetails(client, key, before.editorialRevision.details, after.version);
            if (before.pendingMedia) await applyBusinessImageProposals(client, key);
          } else if (before.pendingMedia) await clearBusinessImageProposals(client, key);
          await audit(client, currentActor.id, before, after, value.status, reason);
          return business(client, key);
        }
        if (value.status === "published") {
          if (before.packagePaymentNeeded) fail(409, "PACKAGE_PAYMENT_REQUIRED");
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
        return business(client, after.id);
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
