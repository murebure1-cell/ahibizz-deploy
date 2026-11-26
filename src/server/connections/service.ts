import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ConnectionItem,
  ConnectionPage,
  ConnectionRelationship,
  ConnectionStatus,
  ProfileVisibility,
  PublicPeoplePage,
  PublicPerson,
  PublicPersonStats,
} from "../../lib/connections";
import type { ProfileImageKind } from "../../lib/people";
import { contactBlocked } from "../account-blocks";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import { canCustomizeCoverSql } from "../people/cover-entitlement";
import { platformBadgeColumns, platformFounderJoin } from "../people/platform-badges";
import {
  ConnectionsAccessError,
  fail,
  listInput,
  mediaVersion,
  personId,
  requestInput,
  searchInput,
  transitionInput,
  uuid,
  visibilityInput,
} from "./validation";

type Query = Pick<PoolClient, "query">;
type SignedSession = { id: string; userId: string; token: string; expectedAccountId?: string };
type Image = { bytes: Buffer; mime: "image/webp"; width: number; height: number; version: number };
type Pair = {
  id: string;
  left_user_id: string;
  right_user_id: string;
  requester_user_id: string;
  status: ConnectionStatus;
  version: number;
};
const pageSize = 20;
const publicColumns = `u.id,u.name,${platformBadgeColumns},p.city,p.country_code AS "countryCode",p.bio,p.skills,p.work_status AS "workStatus",photo.version AS "photoVersion",CASE WHEN cover.version IS NOT NULL THEN CASE WHEN ${canCustomizeCoverSql} THEN cover.version END END AS "coverVersion"`;
const publicJoins = `JOIN personal_profile p ON p.user_id=u.id AND p.is_public=true ${platformFounderJoin} LEFT JOIN personal_profile_image photo ON photo.user_id=u.id AND photo.kind='photo' LEFT JOIN personal_profile_image cover ON cover.user_id=u.id AND cover.kind='cover'`;
const publicEligibility = `u.approval='approved' AND u."emailVerified"=true AND u.role IN ('member','owner')`;

function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (!user.emailVerified) fail(403, "EMAIL_NOT_VERIFIED");
  if (user.role !== "member" && user.role !== "owner") fail(403, "ACCOUNT_ACCESS_DENIED");
}
async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ConnectionsAccessError) throw error;
    if (error instanceof AccountAccessError)
      throw new ConnectionsAccessError(error.status, error.code);
    throw new ConnectionsAccessError(503, "CONNECTIONS_UNAVAILABLE");
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
      throw error;
    } finally {
      client.release(discard);
    }
  });
}
async function authority(client: PoolClient, session: SignedSession, otherIds: string[] = []) {
  // Match the shared sorted auth-user lock order before taking session/profile/pair locks.
  const ids = [...new Set([session.userId, ...otherIds])].sort();
  const users = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
      [ids],
    )
  ).rows;
  const actor = users.find((user) => user.id === session.userId);
  eligible(actor);
  if (session.expectedAccountId !== undefined && actor.id !== session.expectedAccountId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  const signed = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [session.id, session.userId, session.token],
  );
  if (signed.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  return { actor, users };
}
function publicPerson(row: PublicPerson): PublicPerson {
  // Explicit projection prevents a later SELECT change from exposing account/private fields.
  return {
    id: row.id,
    name: row.name,
    verified: row.verified,
    platformFounder: row.platformFounder,
    platformAdministrator: row.platformAdministrator,
    city: row.city,
    countryCode: row.countryCode,
    bio: row.bio,
    skills: row.skills,
    workStatus: row.workStatus,
    photoVersion: row.photoVersion,
    coverVersion: row.coverVersion,
  };
}
async function readPublic(query: Query, id: string): Promise<PublicPerson> {
  const row = (
    await query.query<PublicPerson>(
      `SELECT ${publicColumns} FROM auth_user u ${publicJoins} WHERE u.id=$1 AND ${publicEligibility}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "PERSON_NOT_FOUND");
  return publicPerson(row);
}
/** What the drawn profile counts: published businesses, friends and the year of joining. */
async function readPublicStats(query: Query, id: string): Promise<PublicPersonStats> {
  const row = (
    await query.query<PublicPersonStats>(
      `SELECT
         (SELECT count(*)::int FROM directory_business b
           WHERE b.owner_user_id=u.id AND b.deleted_at IS NULL AND b.status='published') AS businesses,
         (SELECT count(*)::int FROM people_connection c
           WHERE c.status='accepted' AND u.id IN (c.left_user_id,c.right_user_id)) AS friends,
         extract(year FROM u."createdAt" AT TIME ZONE 'Europe/Sarajevo')::int AS "joinedYear"
       FROM auth_user u ${publicJoins} WHERE u.id=$1 AND ${publicEligibility}`,
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "PERSON_NOT_FOUND");
  return row;
}
async function requirePublicActor(query: Query, id: string) {
  if (
    !(
      await query.query(
        "SELECT user_id FROM personal_profile WHERE user_id=$1 AND is_public=true",
        [id],
      )
    ).rowCount
  )
    fail(403, "PUBLIC_PROFILE_REQUIRED");
}
async function visibility(query: Query, id: string): Promise<ProfileVisibility> {
  return (
    (
      await query.query<ProfileVisibility>(
        'SELECT is_public AS "isPublic",version AS "profileVersion" FROM personal_profile WHERE user_id=$1',
        [id],
      )
    ).rows[0] ?? { isPublic: false, profileVersion: 0 }
  );
}
function relationship(
  row: Pair | undefined,
  actorId: string,
  targetId: string,
): ConnectionRelationship {
  if (!row) return { id: null, status: "none", direction: null, version: 0, personId: targetId };
  return {
    id: row.id,
    status: row.status,
    direction: row.requester_user_id === actorId ? "outgoing" : "incoming",
    version: row.version,
    personId: targetId,
  };
}
function otherId(row: Pair, actorId: string): string {
  if (row.left_user_id === actorId) return row.right_user_id;
  if (row.right_user_id === actorId) return row.left_user_id;
  fail(404, "CONNECTION_NOT_FOUND");
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function receipt(query: Query, actorId: string, requestId: string, intent: string) {
  const result = (
    await query.query<ConnectionRelationship & { fingerprint: string }>(
      'SELECT fingerprint,connection_id AS id,person_id AS "personId",result_status AS status,result_direction AS direction,result_version AS version FROM people_connection_command WHERE actor_user_id=$1 AND request_id=$2',
      [actorId, requestId],
    )
  ).rows[0];
  if (!result) return null;
  if (result.fingerprint !== intent) fail(409, "IDEMPOTENCY_CONFLICT");
  return {
    id: result.id,
    personId: result.personId,
    status: result.status,
    direction: result.direction,
    version: result.version,
  };
}
async function record(
  query: Query,
  actorId: string,
  requestId: string,
  intent: string,
  action: "request" | "accept" | "decline" | "cancel" | "remove",
  before: Pair | undefined,
  after: Pair,
): Promise<ConnectionRelationship> {
  const result = relationship(after, actorId, otherId(after, actorId));
  await query.query(
    "INSERT INTO people_connection_command(actor_user_id,request_id,fingerprint,connection_id,person_id,result_status,result_direction,result_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      actorId,
      requestId,
      intent,
      after.id,
      result.personId,
      result.status,
      result.direction,
      result.version,
    ],
  );
  await query.query(
    "INSERT INTO people_connection_event(id,connection_id,actor_user_id,action,previous_status,next_status,previous_version,next_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      after.id,
      actorId,
      action,
      before?.status ?? null,
      after.status,
      before?.version ?? 0,
      after.version,
    ],
  );
  return result;
}

export function createConnectionsService({
  accounts,
  auth,
  pool,
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
}) {
  async function session(headers: Headers): Promise<SignedSession> {
    return safe(async () => {
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null) personId(expectedAccountId);
      const identity = await accounts.read(headers);
      const value = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!value?.session || value.session.userId !== identity.id || value.user.id !== identity.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        id: value.session.id,
        userId: value.session.userId,
        token: value.session.token,
        ...(expectedAccountId === null ? {} : { expectedAccountId }),
      };
    });
  }
  return {
    async readViewer(headers: Headers): Promise<{ id: string } | null> {
      try {
        const current = await session(headers);
        return await transaction(pool, async (client) => {
          const { actor } = await authority(client, current);
          return { id: actor.id };
        });
      } catch (error) {
        if (
          error instanceof ConnectionsAccessError &&
          (error.status === 401 || error.status === 403)
        )
          return null;
        throw error;
      }
    },
    async readVisibility(headers: Headers): Promise<ProfileVisibility> {
      const current = await session(headers);
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, current);
        return visibility(client, actor.id);
      });
    },
    async setVisibility(headers: Headers, input: unknown, key: string): Promise<ProfileVisibility> {
      const value = visibilityInput(input),
        requestId = uuid(key),
        current = await session(headers);
      const intent = fingerprint({ operation: "visibility", ...value });
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, current);
        const prior = (
          await client.query<ProfileVisibility & { fingerprint: string }>(
            'SELECT fingerprint,result_is_public AS "isPublic",result_profile_version AS "profileVersion" FROM personal_profile_visibility_command WHERE actor_user_id=$1 AND request_id=$2',
            [actor.id, requestId],
          )
        ).rows[0];
        if (prior) {
          if (prior.fingerprint !== intent) fail(409, "IDEMPOTENCY_CONFLICT");
          return { isPublic: prior.isPublic, profileVersion: prior.profileVersion };
        }
        const before = await visibility(client, actor.id);
        if (before.profileVersion !== value.expectedVersion) fail(409, "VERSION_CONFLICT");
        const saved = (
          await client.query<ProfileVisibility>(
            'INSERT INTO personal_profile(user_id,is_public,version) VALUES($1,$2,1) ON CONFLICT(user_id) DO UPDATE SET is_public=EXCLUDED.is_public,version=personal_profile.version+1,updated_at=now() WHERE personal_profile.version=$3 RETURNING is_public AS "isPublic",version AS "profileVersion"',
            [actor.id, value.isPublic, value.expectedVersion],
          )
        ).rows[0];
        if (!saved) fail(409, "VERSION_CONFLICT");
        await client.query(
          "INSERT INTO personal_profile_visibility_command(actor_user_id,request_id,fingerprint,result_is_public,result_profile_version) VALUES($1,$2,$3,$4,$5)",
          [actor.id, requestId, intent, saved.isPublic, saved.profileVersion],
        );
        await client.query(
          "INSERT INTO personal_profile_visibility_event(id,user_id,previous_is_public,next_is_public,previous_profile_version,next_profile_version) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            actor.id,
            before.isPublic,
            saved.isPublic,
            before.profileVersion,
            saved.profileVersion,
          ],
        );
        return saved;
      });
    },
    async searchPublic(input: unknown): Promise<PublicPeoplePage> {
      const value = searchInput(input),
        pattern = `%${value.q.replace(/[\\%_]/g, "\\$&")}%`;
      return transaction(pool, async (client) => {
        const rows = (
          await client.query<PublicPerson>(
            `SELECT ${publicColumns} FROM auth_user u ${publicJoins} WHERE ${publicEligibility} AND (u.name ILIKE $1 OR p.city ILIKE $1) ORDER BY lower(u.name),u.id COLLATE "C" LIMIT $2 OFFSET $3`,
            [pattern, pageSize + 1, (value.page - 1) * pageSize],
          )
        ).rows;
        return {
          items: rows.slice(0, pageSize).map(publicPerson),
          page: value.page,
          hasMore: rows.length > pageSize,
        };
      });
    },
    async readPublic(inputId: string): Promise<PublicPerson> {
      const id = personId(inputId);
      return transaction(pool, (client) => readPublic(client, id));
    },
    async readPublicStats(inputId: string): Promise<PublicPersonStats> {
      const id = personId(inputId);
      return transaction(pool, (client) => readPublicStats(client, id));
    },
    async readPublicMedia(
      inputId: string,
      kind: ProfileImageKind,
      expectedMediaVersion: number,
    ): Promise<Image | null> {
      const id = personId(inputId),
        wanted = mediaVersion(expectedMediaVersion);
      if (kind !== "photo" && kind !== "cover") fail(400, "INVALID_CONNECTION_INPUT");
      return transaction(pool, async (client) => {
        // Visibility, current eligibility, entitlement and exact image version are checked in one statement.
        const row = (
          await client.query<Image>(
            `SELECT image.bytes,image.mime,image.width,image.height,image.version FROM auth_user u JOIN personal_profile p ON p.user_id=u.id AND p.is_public=true JOIN personal_profile_image image ON image.user_id=u.id AND image.kind=$2 AND image.version=$3 WHERE u.id=$1 AND ${publicEligibility} AND ($2='photo' OR ${canCustomizeCoverSql})`,
            [id, kind, wanted],
          )
        ).rows[0];
        return row ?? null;
      });
    },
    async relationship(headers: Headers, inputId: string): Promise<ConnectionRelationship> {
      const id = personId(inputId),
        current = await session(headers);
      if (id === current.userId) fail(400, "SELF_CONNECTION");
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, current);
        const [left, right] = [actor.id, id].sort();
        const row = (
          await client.query<Pair>(
            "SELECT * FROM people_connection WHERE left_user_id=$1 AND right_user_id=$2",
            [left, right],
          )
        ).rows[0];
        if (!row) await readPublic(client, id);
        return relationship(row, actor.id, id);
      });
    },
    async list(headers: Headers, input: unknown): Promise<ConnectionPage> {
      const value = listInput(input),
        current = await session(headers);
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, current);
        const rows = (
          await client.query<
            Omit<PublicPerson, "id"> & {
              id: string | null;
              personId: string;
              connectionId: string;
              status: ConnectionStatus;
              version: number;
              requesterId: string;
            }
          >(
            `SELECT person.*,c.id AS "connectionId",c.status,c.version,c.requester_user_id AS "requesterId",CASE WHEN c.left_user_id=$1 THEN c.right_user_id ELSE c.left_user_id END AS "personId" FROM people_connection c LEFT JOIN LATERAL (SELECT ${publicColumns} FROM auth_user u ${publicJoins} WHERE u.id=CASE WHEN c.left_user_id=$1 THEN c.right_user_id ELSE c.left_user_id END AND ${publicEligibility}) person ON true WHERE (c.left_user_id=$1 OR c.right_user_id=$1) AND NOT people_contact_blocked(c.left_user_id,c.right_user_id) AND (($2='contacts' AND c.status='accepted') OR ($2='incoming' AND c.status='pending' AND c.requester_user_id<>$1) OR ($2='outgoing' AND c.status='pending' AND c.requester_user_id=$1)) ORDER BY c.updated_at DESC,c.id LIMIT $3 OFFSET $4`,
            [actor.id, value.view, pageSize + 1, (value.page - 1) * pageSize],
          )
        ).rows;
        const items: ConnectionItem[] = rows.slice(0, pageSize).map((row) => ({
          id: row.connectionId,
          status: row.status,
          version: row.version,
          personId: row.personId,
          direction: row.requesterId === actor.id ? "outgoing" : "incoming",
          person: row.id === null ? null : publicPerson({ ...row, id: row.id }),
        }));
        return { items, page: value.page, hasMore: rows.length > pageSize };
      });
    },
    async request(
      headers: Headers,
      inputId: string,
      input: unknown,
      key: string,
    ): Promise<ConnectionRelationship> {
      const id = personId(inputId),
        value = requestInput(input),
        requestId = uuid(key),
        current = await session(headers);
      if (id === current.userId) fail(400, "SELF_CONNECTION");
      const intent = fingerprint({ operation: "request", id, ...value });
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, current, [id]);
        const prior = await receipt(client, actor.id, requestId, intent);
        if (prior) return prior;
        if (await contactBlocked(client, actor.id, id)) fail(409, "CONTACT_UNAVAILABLE");
        await requirePublicActor(client, actor.id);
        await readPublic(client, id);
        const [left, right] = [actor.id, id].sort();
        const before = (
          await client.query<Pair>(
            "SELECT * FROM people_connection WHERE left_user_id=$1 AND right_user_id=$2 FOR UPDATE",
            [left, right],
          )
        ).rows[0];
        if ((before?.version ?? 0) !== value.expectedVersion) fail(409, "VERSION_CONFLICT");
        if (before?.status === "pending" || before?.status === "accepted")
          fail(409, "CONNECTION_ALREADY_EXISTS");
        const after = before
          ? (
              await client.query<Pair>(
                "UPDATE people_connection SET requester_user_id=$2,status='pending',version=version+1,updated_at=now() WHERE id=$1 AND version=$3 RETURNING *",
                [before.id, actor.id, value.expectedVersion],
              )
            ).rows[0]
          : (
              await client.query<Pair>(
                "INSERT INTO people_connection(id,left_user_id,right_user_id,requester_user_id,status,version) VALUES($1,$2,$3,$4,'pending',1) RETURNING *",
                [randomUUID(), left, right, actor.id],
              )
            ).rows[0];
        if (!after) fail(409, "VERSION_CONFLICT");
        return record(client, actor.id, requestId, intent, "request", before, after);
      });
    },
    async transition(
      headers: Headers,
      inputId: string,
      input: unknown,
      key: string,
    ): Promise<ConnectionRelationship> {
      const id = uuid(inputId),
        value = transitionInput(input),
        requestId = uuid(key),
        current = await session(headers);
      const intent = fingerprint({ operation: "transition", id, ...value });
      return transaction(pool, async (client) => {
        const hint = (await client.query<Pair>("SELECT * FROM people_connection WHERE id=$1", [id]))
          .rows[0];
        if (!hint) fail(404, "CONNECTION_NOT_FOUND");
        const target = otherId(hint, current.userId);
        const { actor } = await authority(client, current, [target]);
        const prior = await receipt(client, actor.id, requestId, intent);
        if (prior) return prior;
        const before = (
          await client.query<Pair>("SELECT * FROM people_connection WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (!before || before.version !== value.expectedVersion) fail(409, "VERSION_CONFLICT");
        otherId(before, actor.id);
        const requester = before.requester_user_id === actor.id;
        if (value.action === "accept" || value.action === "decline") {
          if (before.status !== "pending" || requester) fail(409, "CONNECTION_ACTION_NOT_ALLOWED");
        } else if (value.action === "cancel") {
          if (before.status !== "pending" || !requester) fail(409, "CONNECTION_ACTION_NOT_ALLOWED");
        } else if (before.status !== "accepted") fail(409, "CONNECTION_ACTION_NOT_ALLOWED");
        if (value.action === "accept") {
          if (await contactBlocked(client, actor.id, target)) fail(409, "CONTACT_UNAVAILABLE");
          await requirePublicActor(client, actor.id);
          await readPublic(client, target);
        }
        const next = {
          accept: "accepted",
          decline: "declined",
          cancel: "cancelled",
          remove: "removed",
        }[value.action];
        const after = (
          await client.query<Pair>(
            "UPDATE people_connection SET status=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 RETURNING *",
            [id, next, value.expectedVersion],
          )
        ).rows[0];
        if (!after) fail(409, "VERSION_CONFLICT");
        return record(client, actor.id, requestId, intent, value.action, before, after);
      });
    },
  };
}
export type ConnectionsService = ReturnType<typeof createConnectionsService>;
let service: ConnectionsService | undefined;
export function getConnectionsService(): ConnectionsService | null {
  if (service) return service;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  service = createConnectionsService({ accounts, auth, pool });
  return service;
}
