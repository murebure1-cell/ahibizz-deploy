import type { Pool, PoolClient } from "pg";
import { businessUuid } from "../../lib/business-today";
import {
  type ManagedReel,
  type PublicReel,
  type ReelFeedPage,
  type ReelStatus,
  reelAccountLimit,
  reelBusinessLimit,
  reelMaxBytes,
  reelMaxPublicationCredits,
  reelPartBytes,
  reelPublicationCredits,
} from "../../lib/reels";
import { AccountAccessError, accountTransaction, createAccountAccess } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../auth/service";
import { debitWallet, walletBalance } from "../wallet/service";
import { normalizeReelPoster, readReelPart, verifyReelVideo } from "./video";

const notFound = () => new AccountAccessError(404, "REEL_NOT_FOUND");
const invalid = () => new AccountAccessError(400, "REEL_INPUT");
const stateChanged = () => new AccountAccessError(409, "REEL_CHANGED");

const visible = `r.status='published' AND b.deleted_at IS NULL AND b.status='published'
  AND b.owner_user_id=r.submitted_by AND package_allows_listing(b)
  AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')`;
const publicFields = `r.id, r.business_id AS "businessId", b.title AS "businessTitle",
  b.city, r.title, r.caption, r.duration_ms AS "durationMs", r.has_poster AS "hasPoster",
  to_char(r.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "publishedAt"`;
const cardFields = `${publicFields}, (
  SELECT jsonb_build_object('kind',i.kind,'slot',i.slot,'version',i.version,'width',i.width,'height',i.height)
  FROM directory_business_image i WHERE i.business_id=b.id AND i.kind='logo' AND i.slot=0
) AS "businessLogo"`;
const managementFields = `${publicFields}, r.status, r.review_reason AS "reviewReason",
  r.created_at::text AS "createdAt", r.price_minor::double precision/100 AS "priceCredits",
  r.wallet_payment_id IS NOT NULL AS paid`;
const fromReels = `FROM business_reel r JOIN directory_business b ON b.id=r.business_id`;
export const publicReels = `${fromReels} JOIN auth_user u ON u.id=b.owner_user_id WHERE ${visible}`;

function context() {
  const auth = getAuthService();
  const pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "REEL_UNAVAILABLE");
  return { access: createAccountAccess(auth), pool };
}

const discoverable = `($4::text IS NULL OR NOT EXISTS(
  SELECT 1 FROM people_block pb WHERE pb.actor_id=$4 AND pb.target_id=r.submitted_by AND pb.blocked))`;
export async function listPublicReels(
  businessId: string | null,
  limit: number,
  offset = 0,
  viewerId: string | null = null,
) {
  if (businessId !== null && !businessUuid(businessId)) return [];
  const pool = getAuthDatabasePool();
  if (!pool) return [];
  const { rows } = await pool.query<PublicReel>(
    `SELECT ${cardFields} ${publicReels}
     AND ($1::uuid IS NULL OR b.id=$1) AND ${discoverable}
     ORDER BY r.published_at DESC,r.id DESC LIMIT $2 OFFSET $3`,
    [businessId, limit, offset, viewerId],
  );
  return rows;
}

export async function readPublicReel(id: string, viewerId: string | null = null) {
  if (!businessUuid(id)) return null;
  const pool = getAuthDatabasePool();
  if (!pool) return null;
  const { rows } = await pool.query<PublicReel>(
    `SELECT ${cardFields} ${publicReels} AND r.id=$1
     AND ($2::text IS NULL OR NOT EXISTS (
       SELECT 1 FROM people_block pb WHERE pb.actor_id=$2 AND pb.target_id=r.submitted_by AND pb.blocked
     ))`,
    [id, viewerId],
  );
  return rows[0] ?? null;
}

/** View the selected clip first, then older clips, followed by remaining newer clips once. */
export async function readReelFeed(
  cursor: string,
  businessId: string | null,
  viewerId: string | null,
  origin = cursor,
  pool = getAuthDatabasePool(),
): Promise<ReelFeedPage> {
  const pageSize = 6;
  if (!businessUuid(cursor) || !businessUuid(origin) || (businessId && !businessUuid(businessId)))
    throw notFound();
  if (!pool) throw new AccountAccessError(503, "REEL_UNAVAILABLE");
  // An already displayed anchor can be withdrawn without making the rest of the feed unavailable.
  // The branches each use the published tuple index and return only a bounded number of rows.
  const { rows } = await pool.query<PublicReel & { phase: number; orderedAt: Date }>(
    `WITH anchors AS (
       SELECT c.id AS cursor_id,c.published_at AS cursor_at,o.id AS origin_id,o.published_at AS origin_at
       FROM business_reel c JOIN business_reel o ON o.id=$3
       WHERE c.id=$2 AND c.published_at IS NOT NULL AND o.published_at IS NOT NULL
         AND ($1::uuid IS NULL OR (c.business_id=$1 AND o.business_id=$1))
     )
     SELECT page.* FROM anchors CROSS JOIN LATERAL (
       (SELECT ${cardFields},0 AS phase,r.published_at AS "orderedAt" ${publicReels}
        AND ($1::uuid IS NULL OR b.id=$1) AND ${discoverable}
        AND (cursor_at,cursor_id)<=(origin_at,origin_id)
        AND (r.published_at,r.id)<(cursor_at,cursor_id)
        ORDER BY r.published_at DESC,r.id DESC LIMIT $5)
       UNION ALL
       (SELECT ${cardFields},1 AS phase,r.published_at AS "orderedAt" ${publicReels}
        AND ($1::uuid IS NULL OR b.id=$1) AND ${discoverable}
        AND (r.published_at,r.id)>(origin_at,origin_id)
        AND ((cursor_at,cursor_id)<=(origin_at,origin_id) OR (r.published_at,r.id)<(cursor_at,cursor_id))
        ORDER BY r.published_at DESC,r.id DESC LIMIT $5)
     ) page ORDER BY phase,"orderedAt" DESC,id DESC LIMIT $5`,
    [businessId, cursor, origin, viewerId, pageSize + 1],
  );
  const items = rows.slice(0, pageSize).map(({ phase, orderedAt, ...item }) => item);
  return { items, next: rows.length > pageSize ? (items.at(-1)?.id ?? null) : null };
}

type BusinessChoice = { id: string; title: string };
export async function manageReels(headers: Headers, admin: boolean, offset = 0) {
  const { access, pool } = context();
  const session = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const actor = await access.authority(client, session, admin, "read");
    const { rows: reels } = await client.query<ManagedReel>(
      admin
        ? `SELECT ${managementFields} ${fromReels} WHERE r.status='pending' AND b.deleted_at IS NULL
           ORDER BY r.created_at,r.id LIMIT 31 OFFSET $1`
        : `SELECT ${managementFields} ${fromReels} WHERE b.deleted_at IS NULL
           AND r.submitted_by=$1 AND b.owner_user_id=$1 AND r.status <> 'withdrawn'
           AND (r.status <> 'uploading' OR r.created_at > clock_timestamp()-interval '24 hours')
           ORDER BY r.created_at DESC,r.id DESC LIMIT 31 OFFSET $2`,
      admin ? [offset] : [actor.id, offset],
    );
    const businesses = admin
      ? []
      : (
          await client.query<BusinessChoice>(
            `SELECT b.id,b.title FROM directory_business b
             WHERE b.owner_user_id=$1 AND b.deleted_at IS NULL AND b.status='published'
               AND package_allows_listing(b) ORDER BY lower(b.title),b.id LIMIT 200`,
            [actor.id],
          )
        ).rows;
    return {
      accountId: actor.id,
      reels: reels.slice(0, 30),
      hasMore: reels.length > 30,
      businesses,
      priceCredits: admin ? null : reelPublicationCredits,
      balance: admin ? null : await walletBalance(client, actor.id),
    };
  });
}

type ReelRow = {
  business_id: string;
  source_size: number;
  status: ReelStatus;
  has_poster: boolean;
  upload_active: boolean;
  title: string;
  caption: string;
  price_minor: string | null;
};

function ownUpload(client: PoolClient, id: string, actorId: string, lock: boolean) {
  return client.query<ReelRow>(
    `SELECT r.business_id,r.source_size,r.status,r.has_poster,r.title,r.caption,r.price_minor,
       r.created_at>clock_timestamp()-interval '24 hours' AS upload_active
     ${fromReels} WHERE r.id=$1 AND r.submitted_by=$2 AND b.owner_user_id=$2
       AND b.deleted_at IS NULL AND b.status='published' AND package_allows_listing(b)
       ${lock ? "FOR UPDATE OF b,r" : "FOR SHARE OF b,r"}`,
    [id, actorId],
  );
}

function editText(value: unknown, maximum: number, required: boolean): string {
  if (typeof value !== "string") throw invalid();
  const clean = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim().normalize("NFC");
  if (
    clean.length > maximum ||
    (required && !clean) ||
    clean.split("\n").some((line) => /[\p{Cc}\p{Cf}]/u.test(line))
  )
    throw invalid();
  return clean;
}

function sameKeys(input: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key))
  );
}

type ReelCommand =
  | {
      action: "create";
      businessId: string;
      title: string;
      caption: string;
      bytes: number;
      poster: boolean;
      priceCredits: number;
    }
  | { action: "submit" }
  | { action: "withdraw"; expected: ReelStatus }
  | { action: "approve" }
  | { action: "reject"; reason: string };

export function parseReelCommand(value: unknown): ReelCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  if (
    input.action === "create" &&
    sameKeys(input, [
      "action",
      "businessId",
      "title",
      "caption",
      "bytes",
      "poster",
      "priceCredits",
    ]) &&
    businessUuid(input.businessId) &&
    typeof input.bytes === "number" &&
    Number.isInteger(input.bytes) &&
    input.bytes >= 32 &&
    input.bytes <= reelMaxBytes &&
    typeof input.poster === "boolean" &&
    typeof input.priceCredits === "number" &&
    Number.isInteger(input.priceCredits) &&
    input.priceCredits >= 1 &&
    input.priceCredits <= reelMaxPublicationCredits
  ) {
    const title = editText(input.title, 100, true);
    if (title.includes("\n")) throw invalid();
    return {
      action: "create",
      businessId: input.businessId.toLowerCase(),
      title,
      caption: editText(input.caption, 600, false),
      bytes: input.bytes,
      poster: input.poster,
      priceCredits: input.priceCredits,
    };
  }
  if ((input.action === "submit" || input.action === "approve") && sameKeys(input, ["action"]))
    return { action: input.action };
  if (input.action === "withdraw" && sameKeys(input, ["action", "expected"])) {
    const expected = input.expected;
    if (
      expected === "uploading" ||
      expected === "pending" ||
      expected === "published" ||
      expected === "rejected"
    )
      return { action: "withdraw", expected };
  }
  if (input.action === "reject" && sameKeys(input, ["action", "reason"]))
    return { action: "reject", reason: editText(input.reason, 600, true) };
  throw invalid();
}

async function beginUpload(
  client: PoolClient,
  actorId: string,
  id: string,
  input: Extract<ReelCommand, { action: "create" }>,
) {
  const business = await client.query(
    `SELECT 1 FROM directory_business b WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL
       AND status='published' AND package_allows_listing(b) FOR UPDATE`,
    [input.businessId, actorId],
  );
  if (!business.rowCount) throw notFound();
  const priceMinor = input.priceCredits * 100;
  await client.query(
    `DELETE FROM business_reel WHERE submitted_by=$1 AND id IN (
       SELECT id FROM business_reel WHERE submitted_by=$1 AND status='uploading'
       AND created_at<=clock_timestamp()-interval '24 hours' ORDER BY created_at LIMIT 16)`,
    [actorId],
  );
  const prior = (await ownUpload(client, id, actorId, true)).rows[0];
  if (prior) {
    if (
      prior.business_id !== input.businessId ||
      prior.source_size !== input.bytes ||
      prior.title !== input.title ||
      prior.caption !== input.caption ||
      prior.has_poster !== input.poster ||
      Number(prior.price_minor) !== priceMinor
    )
      throw stateChanged();
    if (prior.status !== "uploading" && prior.status !== "pending" && prior.status !== "published")
      throw stateChanged();
    return prior.status;
  }
  const limits = (
    await client.query<{ overall: number; listing: number; recent: number }>(
      `SELECT count(*) FILTER (WHERE b.owner_user_id=$1 AND b.deleted_at IS NULL AND r.status IN ('uploading','pending','published'))::int AS overall,
        count(*) FILTER (WHERE r.business_id=$2 AND r.status IN ('uploading','pending','published'))::int AS listing,
        count(*) FILTER (WHERE r.created_at>clock_timestamp()-interval '24 hours')::int AS recent
       ${fromReels} WHERE r.submitted_by=$1`,
      [actorId, input.businessId],
    )
  ).rows[0];
  if (!limits || limits.overall >= reelAccountLimit || limits.listing >= reelBusinessLimit)
    throw new AccountAccessError(409, "REEL_LIMIT");
  if (limits.recent >= 24) throw new AccountAccessError(429, "REEL_DAILY_LIMIT");
  if (input.priceCredits !== reelPublicationCredits)
    throw new AccountAccessError(409, "REEL_PRICE_CHANGED");
  if ((await walletBalance(client, actorId)) < input.priceCredits)
    throw new AccountAccessError(409, "INSUFFICIENT_CREDITS");
  const inserted = await client.query(
    `INSERT INTO business_reel (id,business_id,submitted_by,title,caption,source_size,has_poster,price_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [
      id,
      input.businessId,
      actorId,
      input.title,
      input.caption,
      input.bytes,
      input.poster,
      priceMinor,
    ],
  );
  if (!inserted.rowCount) throw stateChanged();
  return "uploading" as const;
}

let validationSlots = 0;
async function submitUpload(client: PoolClient, actorId: string, id: string) {
  const reel = (await ownUpload(client, id, actorId, true)).rows[0];
  if (!reel) throw notFound();
  if (reel.status === "pending" || reel.status === "published") return reel.status;
  if (reel.status !== "uploading" || !reel.upload_active) throw stateChanged();
  if (reel.price_minor === null) throw new AccountAccessError(409, "REEL_PRICE_REQUIRED");
  if (validationSlots >= 3) throw new AccountAccessError(503, "REEL_BUSY");
  validationSlots++;
  try {
    const parts = await client.query<{ part_index: number; bytes: Buffer }>(
      "SELECT part_index,bytes FROM business_reel_part WHERE reel_id=$1 ORDER BY part_index",
      [id],
    );
    const poster = parts.rows[0]?.part_index === -1;
    const video = poster ? parts.rows.slice(1) : parts.rows;
    const count = Math.ceil(reel.source_size / reelPartBytes);
    if (
      poster !== reel.has_poster ||
      video.length !== count ||
      video.some(
        ({ part_index, bytes }, index) =>
          part_index !== index || bytes.length !== expectedReelPart(reel.source_size, index),
      )
    )
      throw new AccountAccessError(409, "REEL_INCOMPLETE");
    const combined = Buffer.concat(
      video.map((p) => p.bytes),
      reel.source_size,
    );
    const { durationMs, metadataParts } = verifyReelVideo(combined);
    for (const index of metadataParts) {
      const offset = index * reelPartBytes;
      await client.query(
        "UPDATE business_reel_part SET bytes=$3 WHERE reel_id=$1 AND part_index=$2",
        [id, index, combined.subarray(offset, offset + reelPartBytes)],
      );
    }
    await client.query("UPDATE business_reel SET status='pending', duration_ms=$2 WHERE id=$1", [
      id,
      durationMs,
    ]);
    return "pending" as const;
  } finally {
    validationSlots--;
  }
}

async function withdrawUpload(
  client: PoolClient,
  id: string,
  actorId: string,
  expected: ReelStatus,
) {
  const row = (
    await client.query<{ status: ReelStatus }>(
      `SELECT r.status ${fromReels} WHERE r.id=$1 AND r.submitted_by=$2
       AND b.owner_user_id=$2 AND b.deleted_at IS NULL FOR UPDATE OF b,r`,
      [id, actorId],
    )
  ).rows[0];
  if (!row) throw notFound();
  if (row.status !== "withdrawn") {
    if (row.status !== expected) throw stateChanged();
    await client.query("UPDATE business_reel SET status='withdrawn' WHERE id=$1", [id]);
    await client.query("DELETE FROM business_reel_part WHERE reel_id=$1", [id]);
  }
  return "withdrawn" as const;
}

async function reviewReel(
  client: PoolClient,
  id: string,
  actorId: string,
  input: Extract<ReelCommand, { action: "approve" | "reject" }>,
) {
  const { rows } = await client.query<{
    status: ReelStatus;
    eligible: boolean;
    submitted_by: string;
    price_minor: string | null;
  }>(
    `SELECT r.status,r.submitted_by,r.price_minor,
      (b.status='published' AND b.deleted_at IS NULL AND b.owner_user_id=r.submitted_by
      AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')) AS eligible
      ${fromReels} JOIN auth_user u ON u.id=b.owner_user_id WHERE r.id=$1 FOR UPDATE OF b,r`,
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound();
  const status = input.action === "approve" ? "published" : "rejected";
  if (row.status === status) return status;
  if (row.status !== "pending") throw stateChanged();
  if (status === "published") {
    if (!row.eligible) throw new AccountAccessError(409, "REEL_BUSINESS_HIDDEN");
    if (row.price_minor === null) throw new AccountAccessError(409, "REEL_PRICE_REQUIRED");
    await debitWallet(client, {
      accountId: row.submitted_by,
      purchaseId: id,
      kind: "reel",
      creditMinor: Number(row.price_minor),
    });
  }
  await client.query(
    `UPDATE business_reel SET status=$2,reviewed_by=$3,reviewed_at=clock_timestamp(),
      review_reason=$4,published_at=CASE WHEN $2='published' THEN clock_timestamp() END,
      wallet_payment_id=CASE WHEN $2='published' THEN id END WHERE id=$1`,
    [id, status, actorId, input.action === "reject" ? input.reason : null],
  );
  if (status === "rejected")
    await client.query("DELETE FROM business_reel_part WHERE reel_id=$1", [id]);
  return status;
}

export async function applyReelCommand(headers: Headers, id: string, input: ReelCommand) {
  if (!businessUuid(id)) throw notFound();
  if (!headers.get("x-ahibizz-account-id"))
    throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
  const { access, pool } = context();
  const session = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const admin = input.action === "approve" || input.action === "reject";
    const actor = await access.authority(client, session, admin);
    switch (input.action) {
      case "create":
        return beginUpload(client, actor.id, id, input);
      case "submit":
        return submitUpload(client, actor.id, id);
      case "withdraw":
        return withdrawUpload(client, id, actor.id, input.expected);
      case "approve":
      case "reject":
        return reviewReel(client, id, actor.id, input);
    }
  });
}

function expectedReelPart(total: number, index: number): number {
  return Math.min(reelPartBytes, total - reelPartBytes * index);
}

export async function uploadReelPart(request: Request, id: string, index: number) {
  if (!businessUuid(id) || !Number.isInteger(index) || index < -1 || index > 31) throw notFound();
  if (!request.headers.get("x-ahibizz-account-id"))
    throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
  const { access, pool } = context();
  const session = await access.session(request.headers);
  const check = async (client: PoolClient, lock: boolean) => {
    const actor = await access.authority(client, session, false, lock ? "write" : "read");
    const row = (await ownUpload(client, id, actor.id, lock)).rows[0];
    if (!row) throw notFound();
    if (row.status !== "uploading" || !row.upload_active) throw stateChanged();
    return row;
  };
  const reel = await accountTransaction(pool, (client) => check(client, false));
  const length = index === -1 ? null : expectedReelPart(reel.source_size, index);
  if ((index === -1 && !reel.has_poster) || (length !== null && length <= 0)) throw invalid();
  const content = await readReelPart(request, length);
  const bytes = index === -1 ? await normalizeReelPoster(content) : content;
  await accountTransaction(pool, async (client) => {
    await check(client, true);
    const prior = (
      await client.query<{ matches: boolean }>(
        "SELECT bytes=$3 AS matches FROM business_reel_part WHERE reel_id=$1 AND part_index=$2",
        [id, index, bytes],
      )
    ).rows[0];
    if (prior) {
      if (!prior.matches) throw stateChanged();
      return;
    }
    await client.query(
      "INSERT INTO business_reel_part (reel_id,part_index,bytes) VALUES ($1,$2,$3)",
      [id, index, bytes],
    );
  });
}

type Query = Pool | PoolClient;
export type MediaRow = { size: number };
export async function reelMediaAccess(
  headers: Headers,
  id: string,
  kind: "video" | "poster",
  preview: boolean,
) {
  if (!businessUuid(id)) throw notFound();
  const { pool, access } = context();
  const subject = preview && (await access.session(headers));
  const withAccess = async <T>(
    query: (client: Query, actor: { id: string; role: string } | null) => Promise<T>,
  ) => {
    if (!subject) return query(pool, null);
    return accountTransaction(pool, async (client) => {
      const actor = await access.authority(client, subject, false, "read");
      return query(client, actor);
    });
  };
  const allowed = (actor: { id: string; role: string } | null) =>
    actor
      ? {
          from: `${fromReels} WHERE r.id=$1 AND b.deleted_at IS NULL
            AND r.status IN ('pending','published') AND
            ($2='owner' OR (r.submitted_by=$3 AND b.owner_user_id=$3))`,
          values: [id, actor.role, actor.id],
        }
      : { from: `${publicReels} AND r.id=$1`, values: [id] };
  const meta = await withAccess(async (client, actor) => {
    const scope = allowed(actor);
    const size =
      kind === "video"
        ? "r.source_size"
        : `(SELECT octet_length(bytes) FROM business_reel_part WHERE reel_id=r.id AND part_index=-1)`;
    const record = (
      await client.query<MediaRow>(`SELECT ${size} AS size ${scope.from}`, scope.values)
    ).rows[0];
    if (!record?.size) throw notFound();
    return record;
  });
  return {
    size: meta.size,
    slice(index: number, offset: number, amount: number) {
      return withAccess(async (client, actor) => {
        const scope = allowed(actor);
        const n = scope.values.length;
        const { rows } = await client.query<{ bytes: Buffer }>(
          `SELECT substring(p.bytes FROM $${n + 2}::int FOR $${n + 3}::int) AS bytes
           FROM business_reel_part p WHERE p.reel_id=(SELECT r.id ${scope.from})
              AND p.part_index=$${n + 1}::int`,
          [...scope.values, index, offset + 1, amount],
        );
        const part = rows[0];
        if (!part || part.bytes.length !== amount) throw notFound();
        return new Uint8Array(part.bytes);
      });
    },
  };
}
