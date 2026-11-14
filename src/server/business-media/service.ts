import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  BusinessMediaAsset,
  BusinessMediaManifest,
  BusinessMediaReceipt,
  PublicBusinessMediaManifest,
} from "../../lib/business-media";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import { normalizeBusinessImage } from "./normalize";
import { BusinessMediaAccessError, fail, kindSlot, object, uuid, version } from "./validation";

type Query = Pick<PoolClient, "query">;
type SignedSession = { id: string; userId: string; token: string };
type Business = {
  id: string;
  owner_user_id: string;
  status: "draft" | "pending" | "published" | "archived";
  version: number;
};
type Image = { bytes: Buffer; mime: "image/webp"; width: number; height: number; version: number };
type ReceiptRow = BusinessMediaReceipt & { fingerprint: string };
const columns = `image.kind,image.slot,image.version,image.width,image.height`;
const eligibleOwner = `u.approval='approved' AND u."emailVerified"=true AND u.role IN ('member','owner')`;
export const businessMediaProjection = `(SELECT jsonb_build_object('logo',(jsonb_agg(asset.value ORDER BY asset.slot) FILTER (WHERE asset.kind='logo'))->0,'cover',(jsonb_agg(asset.value ORDER BY asset.slot) FILTER (WHERE asset.kind='cover'))->0,'gallery',COALESCE(jsonb_agg(asset.value ORDER BY asset.slot) FILTER (WHERE asset.kind='gallery'),'[]'::jsonb)) FROM (SELECT image.kind,image.slot,jsonb_build_object('kind',image.kind,'slot',image.slot,'version',image.version,'width',image.width,'height',image.height) AS value FROM directory_business_image image WHERE image.business_id=b.id) asset)`;

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
    if (error instanceof BusinessMediaAccessError) throw error;
    if (error instanceof AccountAccessError)
      throw new BusinessMediaAccessError(error.status, error.code);
    throw new BusinessMediaAccessError(503, "BUSINESS_MEDIA_UNAVAILABLE");
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
async function context(client: PoolClient, session: SignedSession, businessId: string) {
  const hint = (
    await client.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM directory_business WHERE id=$1",
      [businessId],
    )
  ).rows[0];
  if (!hint) fail(404, "BUSINESS_NOT_FOUND");
  const ids = [...new Set([session.userId, hint.owner_user_id])].sort();
  const users = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
      [ids],
    )
  ).rows;
  const actor = users.find((row) => row.id === session.userId);
  eligible(actor);
  const signed = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [session.id, session.userId, session.token],
  );
  if (signed.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  const business = (
    await client.query<Business>(
      "SELECT id,owner_user_id,status,version FROM directory_business WHERE id=$1 FOR UPDATE",
      [businessId],
    )
  ).rows[0];
  if (!business || business.owner_user_id !== hint.owner_user_id) fail(409, "VERSION_CONFLICT");
  if (actor.role !== "owner" && business.owner_user_id !== actor.id)
    fail(404, "BUSINESS_NOT_FOUND");
  return { actor, business };
}
async function manifest(query: Query, business: Business): Promise<BusinessMediaManifest> {
  const images = (
    await query.query<BusinessMediaAsset>(
      `SELECT ${columns} FROM directory_business_image image WHERE image.business_id=$1 ORDER BY CASE image.kind WHEN 'logo' THEN 0 WHEN 'cover' THEN 1 ELSE 2 END,image.slot`,
      [business.id],
    )
  ).rows;
  return {
    businessId: business.id,
    businessVersion: business.version,
    status: business.status,
    logo: images.find((row) => row.kind === "logo") ?? null,
    cover: images.find((row) => row.kind === "cover") ?? null,
    gallery: images.filter((row) => row.kind === "gallery"),
  };
}
async function receipt(
  query: Query,
  actorId: string,
  requestId: string,
  fingerprint: string,
): Promise<BusinessMediaReceipt | null> {
  const row = (
    await query.query<ReceiptRow>(
      'SELECT fingerprint,business_id AS "businessId",result_business_version AS "businessVersion",result_status AS status,kind,slot,result_media_version AS "mediaVersion" FROM directory_business_media_command WHERE actor_user_id=$1 AND request_id=$2',
      [actorId, requestId],
    )
  ).rows[0];
  if (!row) return null;
  if (row.fingerprint !== fingerprint) fail(409, "IDEMPOTENCY_CONFLICT");
  const { fingerprint: _private, ...result } = row;
  return result;
}
function editable(business: Business, wanted: number) {
  if (business.version !== wanted) fail(409, "VERSION_CONFLICT");
  if (business.status === "archived") fail(409, "BUSINESS_ARCHIVED");
  if (business.version >= 2147483647) fail(409, "VERSION_EXHAUSTED");
}
async function record(
  client: PoolClient,
  actor: CurrentAuthUser,
  before: Business,
  operation: "put" | "delete",
  kind: "logo" | "cover" | "gallery",
  slot: number,
  previousMediaVersion: number | null,
  requestId: string,
  fingerprint: string,
  inputHash: string | null,
): Promise<BusinessMediaReceipt> {
  const status =
    actor.role === "member" && before.status === "published" ? "pending" : before.status;
  if (status === "archived") fail(409, "BUSINESS_ARCHIVED");
  const saved = (
    await client.query<{ version: number }>(
      "UPDATE directory_business SET version=version+1,status=$2,updated_at=now(),published_at=CASE WHEN $2='published' THEN published_at ELSE NULL END WHERE id=$1 AND version=$3 RETURNING version",
      [before.id, status, before.version],
    )
  ).rows[0];
  if (!saved) fail(409, "VERSION_CONFLICT");
  const mediaVersion = operation === "put" ? saved.version : null;
  await client.query(
    "INSERT INTO directory_business_media_command(actor_user_id,request_id,fingerprint,input_sha256,operation,business_id,kind,slot,result_business_version,result_status,result_media_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      actor.id,
      requestId,
      fingerprint,
      inputHash,
      operation,
      before.id,
      kind,
      slot,
      saved.version,
      status,
      mediaVersion,
    ],
  );
  await client.query(
    "INSERT INTO directory_business_media_event(id,business_id,actor_user_id,operation,kind,slot,previous_business_version,next_business_version,previous_media_version,next_media_version,previous_status,next_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      randomUUID(),
      before.id,
      actor.id,
      operation,
      kind,
      slot,
      before.version,
      saved.version,
      previousMediaVersion,
      mediaVersion,
      before.status,
      status,
    ],
  );
  return {
    businessId: before.id,
    businessVersion: saved.version,
    status,
    kind,
    slot,
    mediaVersion,
  };
}

export function createBusinessMediaService({
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
      const identity = await accounts.read(headers),
        value = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
      if (!value?.session || value.session.userId !== identity.id || value.user.id !== identity.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return value.session;
    });
  }
  return {
    async readOwn(headers: Headers, inputId: string): Promise<BusinessMediaManifest> {
      const id = uuid(inputId),
        signed = await session(headers);
      return transaction(pool, async (client) =>
        manifest(client, (await context(client, signed, id)).business),
      );
    },
    async readPublic(inputId: string): Promise<PublicBusinessMediaManifest> {
      const id = uuid(inputId);
      return safe(async () => {
        const row = (
          await pool.query<PublicBusinessMediaManifest>(
            `SELECT b.id AS "businessId",${businessMediaProjection} AS media FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.id=$1 AND b.status='published' AND ${eligibleOwner}`,
            [id],
          )
        ).rows[0] as
          | (PublicBusinessMediaManifest & {
              media: Omit<PublicBusinessMediaManifest, "businessId">;
            })
          | undefined;
        if (!row) fail(404, "BUSINESS_NOT_FOUND");
        return {
          businessId: row.businessId,
          logo: row.media.logo,
          cover: row.media.cover,
          gallery: row.media.gallery,
        };
      });
    },
    async readOwnImage(
      headers: Headers,
      inputId: string,
      inputKind: unknown,
      inputSlot: unknown,
      wantedVersion: number,
    ): Promise<Image | null> {
      const id = uuid(inputId),
        { kind, slot } = kindSlot(inputKind, inputSlot),
        wanted = version(wantedVersion, 2147483647),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        await context(client, signed, id);
        return (
          (
            await client.query<Image>(
              "SELECT bytes,mime,width,height,version FROM directory_business_image WHERE business_id=$1 AND kind=$2 AND slot=$3 AND version=$4",
              [id, kind, slot, wanted],
            )
          ).rows[0] ?? null
        );
      });
    },
    async readPublicImage(
      inputId: string,
      inputKind: unknown,
      inputSlot: unknown,
      wantedVersion: number,
    ): Promise<Image | null> {
      const id = uuid(inputId),
        { kind, slot } = kindSlot(inputKind, inputSlot),
        wanted = version(wantedVersion, 2147483647);
      return safe(
        async () =>
          (
            await pool.query<Image>(
              `SELECT image.bytes,image.mime,image.width,image.height,image.version FROM directory_business_image image JOIN directory_business b ON b.id=image.business_id JOIN auth_user u ON u.id=b.owner_user_id WHERE b.id=$1 AND image.kind=$2 AND image.slot=$3 AND image.version=$4 AND b.status='published' AND ${eligibleOwner}`,
              [id, kind, slot, wanted],
            )
          ).rows[0] ?? null,
      );
    },
    async save(
      headers: Headers,
      inputId: string,
      inputKind: unknown,
      inputSlot: unknown,
      input: unknown,
      key: string,
    ): Promise<BusinessMediaReceipt> {
      const id = uuid(inputId),
        { kind, slot } = kindSlot(inputKind, inputSlot),
        value = object(input, ["expectedVersion", "bytes"]),
        wanted = version(value.expectedVersion),
        requestId = uuid(key);
      if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0)
        fail(400, "MEDIA_INVALID");
      if (value.bytes.byteLength > 4 * 1024 * 1024) fail(413, "MEDIA_TOO_LARGE");
      const bytes = Buffer.from(value.bytes),
        inputHash = createHash("sha256").update(bytes).digest("hex"),
        fingerprint = createHash("sha256")
          .update(JSON.stringify({ operation: "put", id, kind, slot, wanted, inputHash }))
          .digest("hex"),
        signed = await session(headers);
      const replay = await transaction(pool, async (client) => {
        const { actor, business } = await context(client, signed, id),
          prior = await receipt(client, actor.id, requestId, fingerprint);
        if (prior) return prior;
        editable(business, wanted);
        return null;
      });
      if (replay) return replay;
      const image = await normalizeBusinessImage(bytes, kind);
      return transaction(pool, async (client) => {
        const { actor, business } = await context(client, signed, id),
          prior = await receipt(client, actor.id, requestId, fingerprint);
        if (prior) return prior;
        editable(business, wanted);
        const previous =
          (
            await client.query<{ version: number }>(
              "SELECT version FROM directory_business_image WHERE business_id=$1 AND kind=$2 AND slot=$3",
              [id, kind, slot],
            )
          ).rows[0]?.version ?? null;
        const saved = await record(
          client,
          actor,
          business,
          "put",
          kind,
          slot,
          previous,
          requestId,
          fingerprint,
          inputHash,
        );
        await client.query(
          "INSERT INTO directory_business_image(business_id,kind,slot,bytes,mime,width,height,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(business_id,kind,slot) DO UPDATE SET bytes=EXCLUDED.bytes,mime=EXCLUDED.mime,width=EXCLUDED.width,height=EXCLUDED.height,version=EXCLUDED.version,updated_at=now()",
          [
            id,
            kind,
            slot,
            image.bytes,
            image.mime,
            image.width,
            image.height,
            saved.businessVersion,
          ],
        );
        return saved;
      });
    },
    async remove(
      headers: Headers,
      inputId: string,
      inputKind: unknown,
      inputSlot: unknown,
      input: unknown,
      key: string,
    ): Promise<BusinessMediaReceipt> {
      const id = uuid(inputId),
        { kind, slot } = kindSlot(inputKind, inputSlot),
        value = object(input, ["expectedVersion"]),
        wanted = version(value.expectedVersion),
        requestId = uuid(key),
        fingerprint = createHash("sha256")
          .update(JSON.stringify({ operation: "delete", id, kind, slot, wanted }))
          .digest("hex"),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor, business } = await context(client, signed, id),
          prior = await receipt(client, actor.id, requestId, fingerprint);
        if (prior) return prior;
        editable(business, wanted);
        const previous = (
          await client.query<{ version: number }>(
            "SELECT version FROM directory_business_image WHERE business_id=$1 AND kind=$2 AND slot=$3",
            [id, kind, slot],
          )
        ).rows[0]?.version;
        if (previous === undefined) fail(404, "MEDIA_NOT_FOUND");
        const saved = await record(
          client,
          actor,
          business,
          "delete",
          kind,
          slot,
          previous,
          requestId,
          fingerprint,
          null,
        );
        await client.query(
          "DELETE FROM directory_business_image WHERE business_id=$1 AND kind=$2 AND slot=$3",
          [id, kind, slot],
        );
        return saved;
      });
    },
  };
}
export type BusinessMediaService = ReturnType<typeof createBusinessMediaService>;
let service: BusinessMediaService | undefined;
export function getBusinessMediaService(): BusinessMediaService | null {
  if (service) return service;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  service = createBusinessMediaService({ accounts, auth, pool });
  return service;
}
