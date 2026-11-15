import type { Pool, PoolClient } from "pg";
import type { PersonalProfile, ProfileImageKind } from "../../lib/people";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import { normalizeProfileImage } from "./media";
import { fail, mediaKind, object, PeopleAccessError, profileInput, version } from "./validation";

type SignedSession = { id: string; userId: string; token: string; expectedAccountId?: string };
type Image = { bytes: Buffer; mime: "image/webp"; width: number; height: number; version: number };
type ProfileRow = Omit<PersonalProfile, "canCustomizeCover">;

function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (!user.emailVerified) fail(403, "EMAIL_NOT_VERIFIED");
  if (user.role !== "member" && user.role !== "owner") fail(403, "ACCOUNT_ACCESS_DENIED");
}
function rethrow(error: unknown): never {
  if (error instanceof PeopleAccessError) throw error;
  if (error instanceof AccountAccessError) throw new PeopleAccessError(error.status, error.code);
  throw new PeopleAccessError(503, "PROFILE_UNAVAILABLE");
}
async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    rethrow(error);
  }
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
    rethrow(error);
  } finally {
    client.release(discard);
  }
}
async function authority(client: PoolClient, session: SignedSession): Promise<CurrentAuthUser> {
  const user = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=$1 FOR UPDATE',
      [session.userId],
    )
  ).rows[0];
  if (session.expectedAccountId !== undefined && user?.id !== session.expectedAccountId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  eligible(user);
  const signed = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [session.id, session.userId, session.token],
  );
  if (signed.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  return user;
}
async function entitled(client: PoolClient, user: CurrentAuthUser): Promise<boolean> {
  if (user.role === "owner") return true;
  return (
    (
      await client.query<{ can_customize_cover: boolean }>(
        "SELECT can_customize_cover FROM personal_profile_entitlement WHERE user_id=$1 FOR SHARE",
        [user.id],
      )
    ).rows[0]?.can_customize_cover === true
  );
}
async function profile(client: PoolClient, user: CurrentAuthUser): Promise<PersonalProfile> {
  const value = (
    await client.query<ProfileRow>(
      `SELECT u.id,u.name,p.birth_date::text AS "birthDate",p.city,p.country_code AS "countryCode",p.bio,COALESCE(p.skills,'{}'::text[]) AS skills,COALESCE(p.work_status,'not_specified') AS "workStatus",COALESCE(p.version,0) AS version,photo.version AS "photoVersion",cover.version AS "coverVersion" FROM auth_user u LEFT JOIN personal_profile p ON p.user_id=u.id LEFT JOIN personal_profile_image photo ON photo.user_id=u.id AND photo.kind='photo' LEFT JOIN personal_profile_image cover ON cover.user_id=u.id AND cover.kind='cover' WHERE u.id=$1`,
      [user.id],
    )
  ).rows[0];
  if (!value) fail(401, "AUTHENTICATION_REQUIRED");
  const canCustomizeCover = await entitled(client, user);
  return {
    ...value,
    coverVersion: canCustomizeCover ? value.coverVersion : null,
    canCustomizeCover,
  };
}
async function bumpVersion(client: PoolClient, id: string, expected: number): Promise<number> {
  const saved = (
    await client.query<{ version: number }>(
      "INSERT INTO personal_profile(user_id,version) VALUES($1,1) ON CONFLICT(user_id) DO UPDATE SET version=personal_profile.version+1,updated_at=now() WHERE personal_profile.version=$2 RETURNING version",
      [id, expected],
    )
  ).rows[0];
  if (!saved) fail(409, "VERSION_CONFLICT");
  return saved.version;
}
async function expected(client: PoolClient, id: string, wanted: number) {
  const current =
    (
      await client.query<{ version: number }>(
        "SELECT version FROM personal_profile WHERE user_id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0]?.version ?? 0;
  if (current !== wanted) fail(409, "VERSION_CONFLICT");
}

export function createPeopleService({
  accounts,
  auth,
  pool,
  now = () => new Date(),
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
  now?: () => Date;
}) {
  async function session(headers: Headers): Promise<SignedSession> {
    try {
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
        fail(400, "INVALID_PROFILE_INPUT");
      const identity = await accounts.read(headers);
      const value = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!value?.session || value.session.userId !== identity.id || value.user.id !== identity.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        ...value.session,
        ...(expectedAccountId === null ? {} : { expectedAccountId }),
      };
    } catch (error) {
      rethrow(error);
    }
  }
  async function read(headers: Headers): Promise<PersonalProfile> {
    const current = await session(headers);
    return transaction(pool, async (client) => profile(client, await authority(client, current)));
  }
  return {
    read,
    async update(headers: Headers, input: unknown): Promise<PersonalProfile> {
      const clock = now();
      if (!(clock instanceof Date) || !Number.isFinite(clock.getTime()))
        fail(503, "PROFILE_UNAVAILABLE");
      const value = profileInput(input, clock),
        current = await session(headers);
      return transaction(pool, async (client) => {
        const user = await authority(client, current);
        await expected(client, user.id, value.expectedVersion);
        const saved = await client.query(
          "INSERT INTO personal_profile(user_id,birth_date,city,country_code,bio,skills,work_status,version) VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(user_id) DO UPDATE SET birth_date=EXCLUDED.birth_date,city=EXCLUDED.city,country_code=EXCLUDED.country_code,bio=EXCLUDED.bio,skills=EXCLUDED.skills,work_status=EXCLUDED.work_status,version=personal_profile.version+1,updated_at=now() WHERE personal_profile.version=$8",
          [
            user.id,
            value.birthDate,
            value.city,
            value.countryCode,
            value.bio,
            value.skills,
            value.workStatus,
            value.expectedVersion,
          ],
        );
        if (saved.rowCount !== 1) fail(409, "VERSION_CONFLICT");
        await client.query('UPDATE auth_user SET name=$1,"updatedAt"=now() WHERE id=$2', [
          value.name,
          user.id,
        ]);
        return profile(client, user);
      });
    },
    async readMedia(headers: Headers, inputKind: ProfileImageKind): Promise<Image | null> {
      const kind = mediaKind(inputKind),
        current = await session(headers);
      return transaction(pool, async (client) => {
        const user = await authority(client, current);
        if (kind === "cover" && !(await entitled(client, user))) fail(403, "COVER_NOT_ALLOWED");
        return (
          (
            await client.query<Image>(
              "SELECT bytes,mime,width,height,version FROM personal_profile_image WHERE user_id=$1 AND kind=$2",
              [user.id, kind],
            )
          ).rows[0] ?? null
        );
      });
    },
    async saveMedia(
      headers: Headers,
      inputKind: ProfileImageKind,
      input: unknown,
    ): Promise<PersonalProfile> {
      const kind = mediaKind(inputKind),
        value = object(input, ["expectedVersion", "bytes"]),
        wanted = version(value.expectedVersion);
      if (!(value.bytes instanceof Uint8Array)) fail(400, "MEDIA_INVALID");
      const before = await read(headers);
      if (kind === "cover" && !before.canCustomizeCover) fail(403, "COVER_NOT_ALLOWED");
      if (before.version !== wanted) fail(409, "VERSION_CONFLICT");
      const image = await normalizeProfileImage(value.bytes, kind),
        current = await session(headers);
      return transaction(pool, async (client) => {
        const user = await authority(client, current);
        if (kind === "cover" && !(await entitled(client, user))) fail(403, "COVER_NOT_ALLOWED");
        await expected(client, user.id, wanted);
        const next = await bumpVersion(client, user.id, wanted);
        await client.query(
          "INSERT INTO personal_profile_image(user_id,kind,bytes,mime,width,height,version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,kind) DO UPDATE SET bytes=EXCLUDED.bytes,mime=EXCLUDED.mime,width=EXCLUDED.width,height=EXCLUDED.height,version=EXCLUDED.version,updated_at=now()",
          [user.id, kind, image.bytes, image.mime, image.width, image.height, next],
        );
        return profile(client, user);
      });
    },
    async removeMedia(
      headers: Headers,
      inputKind: ProfileImageKind,
      input: unknown,
    ): Promise<PersonalProfile> {
      const kind = mediaKind(inputKind),
        value = object(input, ["expectedVersion"]),
        wanted = version(value.expectedVersion),
        current = await session(headers);
      return transaction(pool, async (client) => {
        const user = await authority(client, current);
        await expected(client, user.id, wanted);
        // Removing a private image remains allowed after an entitlement is revoked.
        await bumpVersion(client, user.id, wanted);
        await client.query("DELETE FROM personal_profile_image WHERE user_id=$1 AND kind=$2", [
          user.id,
          kind,
        ]);
        return profile(client, user);
      });
    },
  };
}
export type PeopleService = ReturnType<typeof createPeopleService>;
let service: PeopleService | undefined;
export function getPeopleService(): PeopleService | null {
  if (service) return service;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  service = createPeopleService({ accounts, auth, pool });
  return service;
}
