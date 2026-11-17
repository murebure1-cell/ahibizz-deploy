import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type OwnReview,
  type OwnReviewState,
  type ReviewCommand,
  type ReviewModerationPage,
  type ReviewPage,
  readOwnReviewState,
  readReviewModerationPage,
  readReviewPage,
} from "../../lib/reviews";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import { reviewBusinessEligibility, reviewVisibility } from "./projection";
import { commandInput, fail, ReviewsAccessError, uuid } from "./validation";

type Session = { id: string; userId: string; token: string; expectedAccountId: string | null };
type Row = {
  id: string;
  business_id: string;
  author_user_id: string;
  rating: number;
  body: string;
  withdrawn: boolean;
  hidden: boolean;
  version: number;
};
type Business = { id: string; owner_user_id: string; status: string };
type Query = Pick<PoolClient, "query">;
function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (!user.emailVerified) fail(403, "EMAIL_NOT_VERIFIED");
  if (!["member", "owner"].includes(user.role)) fail(403, "ACCOUNT_ACCESS_DENIED");
}
async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ReviewsAccessError) throw error;
    if (error instanceof AccountAccessError) throw new ReviewsAccessError(error.status, error.code);
    throw new ReviewsAccessError(503, "REVIEWS_UNAVAILABLE");
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
function own(row: Row | undefined): OwnReview | null {
  return row
    ? {
        id: row.id,
        rating: row.rating,
        text: row.body,
        withdrawn: row.withdrawn,
        hidden: row.hidden,
        version: row.version,
      }
    : null;
}
async function business(query: Query, id: string, lock = false): Promise<Business> {
  const b = (
    await query.query<Business>(
      `SELECT id,owner_user_id,status FROM directory_business WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!b) fail(404, "BUSINESS_NOT_FOUND");
  return b;
}
async function publicBusiness(query: Query, id: string) {
  if (
    !(
      await query.query(
        `SELECT b.id FROM directory_business b JOIN auth_user o ON o.id=b.owner_user_id WHERE b.id=$1 AND ${reviewBusinessEligibility}`,
        [id],
      )
    ).rowCount
  )
    fail(404, "BUSINESS_NOT_FOUND");
}
async function authority(client: PoolClient, current: Session, otherIds: string[] = []) {
  const ids = [...new Set([current.userId, ...otherIds])].sort();
  const users = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
      [ids],
    )
  ).rows;
  const actor = users.find((u) => u.id === current.userId);
  eligible(actor);
  if (current.expectedAccountId !== null && current.expectedAccountId !== actor.id)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  await freshSession(client, current);
  return actor;
}
async function freshSession(client: Query, current: Session) {
  const result = await client.query(
    'WITH locked AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked WHERE "expiresAt">clock_timestamp()',
    [current.id, current.userId, current.token],
  );
  if (result.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
}
async function receipt(
  client: Query,
  actor: string,
  key: string,
  intent: string,
): Promise<ReviewCommand | null> {
  const prior = (
    await client.query<ReviewCommand & { fingerprint: string }>(
      "SELECT fingerprint,review_id AS id,result_version AS version FROM business_review_command WHERE actor_user_id=$1 AND request_id=$2",
      [actor, key],
    )
  ).rows[0];
  if (!prior) return null;
  if (prior.fingerprint !== intent) fail(409, "IDEMPOTENCY_CONFLICT");
  return { id: prior.id, version: prior.version };
}
async function record(
  client: Query,
  actor: string,
  key: string,
  intent: string,
  action: string,
  before: Row | undefined,
  after: Row,
  reason: string | null,
): Promise<ReviewCommand> {
  await client.query(
    "INSERT INTO business_review_command(actor_user_id,request_id,fingerprint,review_id,result_version) VALUES($1,$2,$3,$4,$5)",
    [actor, key, intent, after.id, after.version],
  );
  await client.query(
    "INSERT INTO business_review_event(id,review_id,actor_user_id,action,previous_version,next_version,previous_rating,next_rating,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      after.id,
      actor,
      action,
      before?.version ?? 0,
      after.version,
      before?.rating ?? null,
      after.rating,
      reason,
    ],
  );
  return { id: after.id, version: after.version };
}
export function createReviewsService({
  accounts,
  auth,
  pool,
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
}) {
  async function session(headers: Headers): Promise<Session> {
    return safe(async () => {
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
        fail(400, "INVALID_REVIEW_INPUT");
      const identity = await accounts.read(headers),
        value = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
      if (!value?.session || value.session.userId !== identity.id || value.user.id !== identity.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        id: value.session.id,
        userId: value.session.userId,
        token: value.session.token,
        expectedAccountId,
      };
    });
  }
  async function mutate(
    headers: Headers,
    target: string,
    input: unknown,
    action: "save" | "withdraw" | "moderate",
  ) {
    const id = uuid(target),
      v = commandInput(input, action),
      current = await session(headers);
    const intent = createHash("sha256")
      .update(JSON.stringify({ action, id, ...v }))
      .digest("hex");
    return transaction(pool, async (client) => {
      const review =
        action === "moderate"
          ? (await client.query<Row>("SELECT * FROM business_review WHERE id=$1", [id])).rows[0]
          : undefined;
      if (action === "moderate" && !review) fail(404, "REVIEW_NOT_FOUND");
      const businessId = review?.business_id ?? id,
        first = await business(client, businessId);
      const actor = await authority(client, current, [first.owner_user_id]);
      if (action === "moderate" && actor.role !== "owner") fail(403, "OWNER_REQUIRED");
      const b = await business(client, businessId, true);
      if (b.owner_user_id !== first.owner_user_id) fail(409, "VERSION_CONFLICT");
      if (action !== "moderate") {
        await publicBusiness(client, businessId);
        if (action === "save" && b.owner_user_id === actor.id) fail(403, "OWN_BUSINESS_REVIEW");
      }
      await freshSession(client, current);
      const prior = await receipt(client, actor.id, v.idempotencyKey, intent);
      if (prior) return prior;
      const before = (
        await client.query<Row>(
          action === "moderate"
            ? "SELECT * FROM business_review WHERE id=$1 FOR UPDATE"
            : "SELECT * FROM business_review WHERE business_id=$1 AND author_user_id=$2 FOR UPDATE",
          action === "moderate" ? [id] : [businessId, actor.id],
        )
      ).rows[0];
      await freshSession(client, current);
      if ((before?.version ?? 0) !== v.expectedVersion) fail(409, "VERSION_CONFLICT");
      if (action === "save" && before?.hidden) fail(403, "REVIEW_HIDDEN");
      let after: Row | undefined;
      if (action === "save") {
        if (before)
          after = (
            await client.query<Row>(
              "UPDATE business_review SET rating=$2,body=$3,withdrawn=false,version=version+1,updated_at=now() WHERE id=$1 AND version=$4 RETURNING *",
              [before.id, v.rating, v.text, v.expectedVersion],
            )
          ).rows[0];
        else
          after = (
            await client.query<Row>(
              "INSERT INTO business_review(id,business_id,author_user_id,rating,body,version) VALUES($1,$2,$3,$4,$5,1) RETURNING *",
              [randomUUID(), businessId, actor.id, v.rating, v.text],
            )
          ).rows[0];
      } else {
        if (!before) fail(404, "REVIEW_NOT_FOUND");
        if (action === "withdraw" && before.withdrawn) fail(409, "REVIEW_ALREADY_WITHDRAWN");
        if (action === "moderate" && before.hidden === v.hidden) fail(409, "REVIEW_UNCHANGED");
        after = (
          await client.query<Row>(
            action === "withdraw"
              ? "UPDATE business_review SET withdrawn=true,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING *"
              : "UPDATE business_review SET hidden=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING *",
            action === "withdraw"
              ? [before.id, v.expectedVersion]
              : [before.id, v.expectedVersion, v.hidden],
          )
        ).rows[0];
      }
      if (!after) fail(409, "VERSION_CONFLICT");
      return record(
        client,
        actor.id,
        v.idempotencyKey,
        intent,
        action === "moderate" ? (v.hidden ? "hide" : "restore") : action,
        before,
        after,
        action === "moderate" ? (v.reason as string) : null,
      );
    });
  }
  return {
    async moderationList(headers: Headers, page = 1): Promise<ReviewModerationPage> {
      if (!Number.isInteger(page) || page < 1 || page > 1000) fail(400, "INVALID_REVIEW_INPUT");
      const current = await session(headers);
      return transaction(pool, async (client) => {
        const actor = await authority(client, current);
        if (actor.role !== "owner") fail(403, "OWNER_REQUIRED");
        const rows = (
          await client.query(
            `SELECT r.id,r.rating,r.body AS text,r.created_at AS "createdAt",r.updated_at AS "updatedAt",r.business_id AS "businessId",b.title AS "businessTitle",r.version,r.hidden,r.withdrawn,json_build_object('id',CASE WHEN p.is_public AND a.approval='approved' AND a."emailVerified" THEN a.id ELSE NULL END,'name',CASE WHEN p.is_public AND a.approval='approved' AND a."emailVerified" THEN a.name ELSE 'Korisnik AhiBizza' END,'photoVersion',CASE WHEN p.is_public AND a.approval='approved' AND a."emailVerified" THEN photo.version ELSE NULL END) AS author FROM business_review r JOIN directory_business b ON b.id=r.business_id JOIN auth_user a ON a.id=r.author_user_id LEFT JOIN personal_profile p ON p.user_id=a.id LEFT JOIN personal_profile_image photo ON photo.user_id=a.id AND photo.kind='photo' ORDER BY r.updated_at DESC,r.id LIMIT 21 OFFSET $1`,
            [(page - 1) * 20],
          )
        ).rows;
        return readReviewModerationPage({
          items: rows.slice(0, 20).map((row) => ({
            ...row,
            createdAt: (row.createdAt as Date).toISOString(),
            updatedAt: (row.updatedAt as Date).toISOString(),
          })),
          page,
          hasMore: rows.length > 20,
          accountId: actor.id,
        });
      });
    },
    async authenticate(headers: Headers) {
      const current = await session(headers);
      return transaction(pool, async (client) => {
        const actor = await authority(client, current);
        return { id: actor.id };
      });
    },
    async list(businessId: string, page = 1): Promise<ReviewPage> {
      const id = uuid(businessId);
      if (!Number.isInteger(page) || page < 1 || page > 1000) fail(400, "INVALID_REVIEW_INPUT");
      return transaction(pool, async (client) => {
        // One statement snapshot binds visible items, eligibility and aggregate together.
        const result = (
          await client.query<{ result: ReviewPage | null }>(
            `WITH target AS MATERIALIZED (SELECT b.id,b.owner_user_id FROM directory_business b JOIN auth_user o ON o.id=b.owner_user_id WHERE b.id=$1 AND ${reviewBusinessEligibility}), visible AS MATERIALIZED (SELECT r.*,CASE WHEN p.is_public THEN a.id ELSE NULL END AS person_id,CASE WHEN p.is_public THEN a.name ELSE 'Korisnik AhiBizza' END AS author_name,CASE WHEN p.is_public THEN photo.version ELSE NULL END AS photo_version FROM business_review r JOIN target b ON b.id=r.business_id JOIN auth_user a ON a.id=r.author_user_id LEFT JOIN personal_profile p ON p.user_id=a.id LEFT JOIN personal_profile_image photo ON photo.user_id=a.id AND photo.kind='photo' WHERE ${reviewVisibility}), selected AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT 21 OFFSET $2) SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN json_build_object('items',COALESCE((SELECT json_agg(item ORDER BY created_at DESC,id) FROM (SELECT created_at,id,json_build_object('id',id,'rating',rating,'text',body,'createdAt',created_at,'updatedAt',updated_at,'author',json_build_object('id',person_id,'name',author_name,'photoVersion',photo_version)) AS item FROM selected ORDER BY created_at DESC,id LIMIT 20) s),'[]'::json),'page',$3::integer,'hasMore',(SELECT count(*)>20 FROM selected),'summary',(SELECT json_build_object('count',count(*)::integer,'sum',COALESCE(sum(rating),0)::integer) FROM visible)) ELSE NULL END AS result`,
            [id, (page - 1) * 20, page],
          )
        ).rows[0]?.result;
        if (!result) fail(404, "BUSINESS_NOT_FOUND");
        return readReviewPage(result);
      });
    },
    async own(headers: Headers, businessId: string): Promise<OwnReviewState> {
      const id = uuid(businessId),
        current = await session(headers);
      return transaction(pool, async (client) => {
        const first = await business(client, id),
          actor = await authority(client, current, [first.owner_user_id]);
        const b = await business(client, id, true);
        if (first.owner_user_id !== b.owner_user_id) fail(409, "VERSION_CONFLICT");
        await publicBusiness(client, id);
        const row = (
          await client.query<Row>(
            "SELECT * FROM business_review WHERE business_id=$1 AND author_user_id=$2",
            [id, actor.id],
          )
        ).rows[0];
        return readOwnReviewState({
          accountId: actor.id,
          canReview: b.owner_user_id !== actor.id,
          review: own(row),
        });
      });
    },
    save: (headers: Headers, id: string, input: unknown) => mutate(headers, id, input, "save"),
    withdraw: (headers: Headers, id: string, input: unknown) =>
      mutate(headers, id, input, "withdraw"),
    moderate: (headers: Headers, id: string, input: unknown) =>
      mutate(headers, id, input, "moderate"),
  };
}
export type ReviewsService = ReturnType<typeof createReviewsService>;
let shared: ReviewsService | undefined;
export function getReviewsService(): ReviewsService | null {
  if (shared) return shared;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  shared = createReviewsService({ accounts, auth, pool });
  return shared;
}
