import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import {
  bamToEuroMinor,
  firstAvailablePromotionStart,
  isPromotionDuration,
  isPromotionKind,
  isPromotionReference,
  type PromotionBank,
  type PromotionKind,
  type PromotionOrder,
  type PromotionPrice,
  promotionCapacity,
} from "../../lib/promotions";
import { AccountAccessError } from "../auth";
import { accountTransaction, createAccountAccess } from "../auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "../auth/service";
import { normalizeRasterImage } from "../media/normalize-image";
import { readPromotionBank } from "./bank";

export class PromotionError extends AccountAccessError {
  constructor(
    status: number,
    code: string,
    readonly firstAvailableAt?: string,
  ) {
    super(status, code);
  }
}
function fail(status: number, code: string): never {
  throw new PromotionError(status, code);
}
export function createPromotionReference() {
  return `AHI-${randomBytes(16).toString("hex")}`;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(input: unknown, keys: string[]) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_PROMOTION");
  return input as Record<string, unknown>;
}
function id(input: unknown) {
  if (typeof input !== "string" || !uuid.test(input)) fail(400, "INVALID_PROMOTION");
  return input;
}
function selection(
  input: unknown,
  extra: string[] = [],
): Record<string, unknown> & {
  businessId: string;
  kind: PromotionKind;
  durationDays: 7 | 14 | 30;
  startsAt: string;
} {
  const value = object(input, ["businessId", "kind", "durationDays", "startsAt", ...extra]);
  const businessId = id(value.businessId);
  if (
    !isPromotionKind(value.kind) ||
    !isPromotionDuration(value.durationDays) ||
    typeof value.startsAt !== "string"
  )
    fail(400, "INVALID_PROMOTION");
  const time = Date.parse(value.startsAt);
  if (!Number.isFinite(time) || time < Date.now() - 60000) fail(400, "INVALID_PROMOTION_DATE");
  return {
    ...value,
    businessId,
    kind: value.kind,
    durationDays: value.durationDays,
    startsAt: new Date(time).toISOString(),
  };
}
function text(input: unknown, max: number) {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.trim().length > max ||
    /[\p{Cc}\p{Cf}]/u.test(input)
  )
    fail(400, "INVALID_PROMOTION");
  return input.trim();
}
const orderColumns = `o.id,o.business_id AS "businessId",b.title AS "businessTitle",o.owner_id AS "ownerId",o.kind,
 o.duration_days AS "durationDays",o.starts_at AS "startsAt",o.ends_at AS "endsAt",o.amount_bam_minor AS "amountBamMinor",
 o.amount_eur_minor AS "amountEurMinor",o.payment_reference AS "paymentReference",
 CASE WHEN o.status='active' AND o.ends_at<=clock_timestamp() THEN 'completed' ELSE o.status END AS status,
 o.confirmed_by AS "confirmedBy",o.confirmed_at AS "confirmedAt",o.statement_reference AS "statementReference",o.manual,o.note,
 EXISTS(SELECT 1 FROM promotion_banner_image i WHERE i.order_id=o.id) AS "hasImage",o.bank_details AS bank`;
function serialize(row: PromotionOrder): PromotionOrder {
  return {
    ...row,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt).toISOString() : null,
  };
}
type Business = {
  id: string;
  title: string;
  ownerId: string;
  city: string | null;
  categoryId: string | null;
};
async function business(client: PoolClient, businessId: string, actorId: string, admin: boolean) {
  const result = await client.query<Business>(
    `SELECT b.id,b.title,b.owner_user_id AS "ownerId",b.city,b.category_id AS "categoryId"
    FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.id=$1 AND b.deleted_at IS NULL
    AND b.status='published' AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner') FOR UPDATE OF b FOR SHARE OF u`,
    [businessId],
  );
  const value = result.rows[0];
  if (!value || (!admin && value.ownerId !== actorId)) fail(404, "BUSINESS_NOT_FOUND");
  return value;
}
function scopeKey(b: Business, kind: PromotionKind) {
  const key =
    kind === "nearby" ? b.city?.trim().toLowerCase() : kind === "category" ? b.categoryId : "*";
  if (!key) fail(400, "PROMOTION_LOCATION_REQUIRED");
  return key;
}
async function reservations(client: PoolClient, kind: PromotionKind, key: string) {
  return (
    await client.query<{ startsAt: string; endsAt: string }>(
      `SELECT starts_at AS "startsAt",ends_at AS "endsAt" FROM promotion_order
    WHERE kind=$1 AND scope_key=$2 AND status IN ('pending','active') AND ends_at>clock_timestamp()`,
      [kind, key],
    )
  ).rows.map((row) => ({
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
  }));
}
async function order(client: PoolClient, orderId: string) {
  const value = (
    await client.query<PromotionOrder>(
      `SELECT ${orderColumns} FROM promotion_order o JOIN directory_business b ON b.id=o.business_id WHERE o.id=$1`,
      [orderId],
    )
  ).rows[0];
  if (!value) fail(404, "PROMOTION_NOT_FOUND");
  return serialize(value);
}
async function priceList(client: PoolClient) {
  return (
    await client.query<PromotionPrice>(
      `SELECT kind,duration_days AS "durationDays",amount_bam_minor AS "amountBamMinor" FROM promotion_price ORDER BY kind,duration_days`,
    )
  ).rows;
}

/**
 * Owner decision 2026-11-24: an unpaid order stops holding its place when its period starts, but
 * a buyer always has at least 3 days from ordering to pay by bank transfer (an order "from now"
 * would otherwise be cancelled at once). Past that point the order is cancelled, so the capacity
 * trigger no longer counts it.
 */
export const unpaidPromotionDeadline = `GREATEST(starts_at, created_at + interval '3 days')`;

export async function expireUnpaidPromotions(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One sweeper at a time: each cancelled row locks its capacity scope inside the trigger.
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('ahibizz-promotion-expiry', 0)) AS locked",
    );
    if (rows[0]?.locked)
      await client.query(
        `UPDATE promotion_order SET status='cancelled'
          WHERE status='pending' AND ${unpaidPromotionDeadline}<=clock_timestamp()`,
      );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => {});
  } finally {
    client.release();
  }
}

export function createPromotionsService({
  pool,
  auth,
  bank = readPromotionBank,
  play = IS_PLAY_EDITION,
}: {
  pool: Pool;
  auth: AuthService;
  bank?: () => PromotionBank | null;
  play?: boolean;
}) {
  const access = createAccountAccess(auth);
  async function run<T>(
    headers: Headers,
    admin: boolean,
    fn: (client: PoolClient, actorId: string) => Promise<T>,
  ): Promise<T> {
    const signed = await access.session(headers);
    if (!signed.expectedAccountId) fail(401, "ACCOUNT_IDENTITY_CHANGED");
    // Never blocks the request: a failed sweep is simply retried by the next one.
    await expireUnpaidPromotions(pool);
    try {
      return await accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, signed, admin);
        return fn(client, actor.id);
      });
    } catch (error) {
      if (error instanceof PromotionError || error instanceof AccountAccessError) throw error;
      throw new PromotionError(503, "PROMOTIONS_UNAVAILABLE");
    }
  }
  function purchasing() {
    if (play) fail(404, "NOT_FOUND");
  }
  async function create(headers: Headers, input: unknown, manual: boolean) {
    purchasing();
    const value = selection(input, manual ? ["note", "imageBase64", "imageMime"] : []);
    const bankDetails = manual ? null : bank();
    if (!manual && !bankDetails) fail(503, "PROMOTION_PAYMENT_UNAVAILABLE");
    const note = manual ? text(value.note, 1000) : null;
    return run(headers, manual, async (client, actorId) => {
      let image: Awaited<ReturnType<typeof normalizeRasterImage>> | null = null;
      if (manual && value.kind === "banner") {
        if (
          typeof value.imageBase64 !== "string" ||
          value.imageBase64.length > 5600000 ||
          !["image/jpeg", "image/png", "image/webp"].includes(String(value.imageMime))
        )
          fail(400, "PROMOTION_IMAGE_REQUIRED");
        image = await normalizeRasterImage(Buffer.from(value.imageBase64, "base64"), {
          width: 1600,
          height: 600,
          fit: "cover",
        });
      }
      const b = await business(client, value.businessId, actorId, manual),
        key = scopeKey(b, value.kind);
      await client.query(
        `INSERT INTO promotion_scope(kind,scope_key) VALUES($1,$2) ON CONFLICT(kind,scope_key) DO NOTHING`,
        [value.kind, key],
      );
      const scope = (
        await client.query<{ id: string }>(
          `SELECT id FROM promotion_scope WHERE kind=$1 AND scope_key=$2 FOR UPDATE`,
          [value.kind, key],
        )
      ).rows[0];
      // Owner decision 2026-11-24: one business holds at most one place per spot and period.
      // The scope row lock above serializes competing orders for the same spot.
      const requestedEnd = new Date(
        Date.parse(value.startsAt) + value.durationDays * 86400000,
      ).toISOString();
      const duplicate = await client.query(
        `SELECT 1 FROM promotion_order WHERE business_id=$1 AND kind=$2 AND scope_key=$3
          AND status IN ('pending','active') AND ends_at>clock_timestamp()
          AND starts_at<$5::timestamptz AND ends_at>$4::timestamptz LIMIT 1`,
        [b.id, value.kind, key, value.startsAt, requestedEnd],
      );
      if (duplicate.rowCount) fail(409, "PROMOTION_DUPLICATE");
      const available = firstAvailablePromotionStart(
        await reservations(client, value.kind, key),
        value.startsAt,
        value.durationDays,
        promotionCapacity[value.kind],
      );
      if (!available.available)
        throw new PromotionError(409, "PROMOTION_FULL", available.firstAvailableAt);
      const price = (
        await client.query<{ amount: number }>(
          `SELECT amount_bam_minor AS amount FROM promotion_price WHERE kind=$1 AND duration_days=$2 FOR SHARE`,
          [value.kind, value.durationDays],
        )
      ).rows[0];
      if (!price || !scope) fail(503, "PROMOTIONS_UNAVAILABLE");
      const orderId = randomUUID(),
        end = new Date(Date.parse(value.startsAt) + value.durationDays * 86400000).toISOString();
      await client.query(
        `INSERT INTO promotion_order(id,business_id,owner_id,kind,scope_id,scope_key,duration_days,starts_at,ends_at,
        amount_bam_minor,amount_eur_minor,payment_reference,status,manual,note,confirmed_by,confirmed_at,bank_details)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CASE WHEN $14 THEN clock_timestamp() ELSE NULL END,$17::jsonb)`,
        [
          orderId,
          b.id,
          b.ownerId,
          value.kind,
          scope.id,
          key,
          value.durationDays,
          value.startsAt,
          end,
          price.amount,
          bamToEuroMinor(price.amount),
          createPromotionReference(),
          manual ? "active" : "pending",
          manual,
          note,
          manual ? actorId : null,
          bankDetails ? JSON.stringify(bankDetails) : null,
        ],
      );
      if (image)
        await client.query(
          `INSERT INTO promotion_banner_image(order_id,mime,bytes,width,height) VALUES($1,$2,$3,$4,$5)`,
          [orderId, image.mime, image.bytes, image.width, image.height],
        );
      return { order: await order(client, orderId) };
    });
  }
  return {
    async list(headers: Headers, admin = false) {
      purchasing();
      return run(headers, admin, async (client, actorId) => ({
        orders: (
          await client.query<PromotionOrder>(
            `SELECT ${orderColumns} FROM promotion_order o JOIN directory_business b ON b.id=o.business_id
          WHERE ($2::boolean OR o.owner_id=$1) ORDER BY o.created_at DESC LIMIT 500`,
            [actorId, admin],
          )
        ).rows.map(serialize),
        businesses: (
          await client.query<Business>(
            `SELECT b.id,b.title,b.city,b.category_id AS "categoryId",b.owner_user_id AS "ownerId"
          FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id WHERE b.deleted_at IS NULL AND b.status='published'
          AND u.approval='approved' AND u."emailVerified" AND ($2::boolean OR b.owner_user_id=$1) ORDER BY b.title`,
            [actorId, admin],
          )
        ).rows,
        prices: await priceList(client),
        bank: bank(),
        purchaseAvailable: !!bank(),
      }));
    },
    create: (headers: Headers, input: unknown) => create(headers, input, false),
    manual: (headers: Headers, input: unknown) => create(headers, input, true),
    async availability(headers: Headers, input: unknown, admin = false) {
      purchasing();
      const value = selection(input);
      return run(headers, admin, async (client, actorId) => {
        const b = await business(client, value.businessId, actorId, admin);
        return firstAvailablePromotionStart(
          await reservations(client, value.kind, scopeKey(b, value.kind)),
          value.startsAt,
          value.durationDays,
          promotionCapacity[value.kind],
        );
      });
    },
    async cancel(headers: Headers, orderId: string, admin = false) {
      purchasing();
      id(orderId);
      return run(headers, admin, async (client, actorId) => {
        const row = (
          await client.query<{ owner_id: string; status: string }>(
            `SELECT owner_id,status FROM promotion_order WHERE id=$1 FOR UPDATE`,
            [orderId],
          )
        ).rows[0];
        if (!row || (!admin && row.owner_id !== actorId)) fail(404, "PROMOTION_NOT_FOUND");
        if ((!admin && row.status !== "pending") || !["pending", "active"].includes(row.status))
          fail(409, "PROMOTION_ALREADY_PROCESSED");
        await client.query(`UPDATE promotion_order SET status='cancelled' WHERE id=$1`, [orderId]);
        return { order: await order(client, orderId) };
      });
    },
    async confirm(headers: Headers, orderId: string, input: unknown) {
      purchasing();
      id(orderId);
      const value = object(input, [
        "amountMinor",
        "currency",
        "paymentReference",
        "statementReference",
      ]);
      if (
        !Number.isSafeInteger(value.amountMinor) ||
        !["BAM", "EUR"].includes(String(value.currency))
      )
        fail(400, "INVALID_PROMOTION_PAYMENT");
      if (value.paymentReference !== undefined && !isPromotionReference(value.paymentReference))
        fail(400, "INVALID_PROMOTION_REFERENCE");
      const statement =
        value.statementReference === undefined || value.statementReference === ""
          ? null
          : text(value.statementReference, 300);
      if (!value.paymentReference && !statement) fail(400, "INVALID_PROMOTION_REFERENCE");
      return run(headers, true, async (client, actorId) => {
        const hint = (
          await client.query<{ business_id: string }>(
            `SELECT business_id FROM promotion_order WHERE id=$1`,
            [orderId],
          )
        ).rows[0];
        if (!hint) fail(404, "PROMOTION_NOT_FOUND");
        // Match listing-change trigger lock order: business, then order, then capacity scope.
        await business(client, hint.business_id, actorId, true);
        const row = (
          await client.query<{ status: string; ends_at: Date; business_id: string }>(
            `SELECT status,ends_at,business_id FROM promotion_order WHERE id=$1 FOR UPDATE`,
            [orderId],
          )
        ).rows[0];
        if (!row) fail(404, "PROMOTION_NOT_FOUND");
        if (row.status !== "pending") fail(409, "PROMOTION_ALREADY_PROCESSED");
        if (row.ends_at.getTime() <= Date.now()) fail(409, "PROMOTION_PERIOD_ENDED");
        const current = await order(client, orderId);
        if (
          value.paymentReference !== undefined &&
          value.paymentReference !== current.paymentReference
        )
          fail(409, "PROMOTION_REFERENCE_MISMATCH");
        if (
          value.amountMinor !==
          (value.currency === "BAM" ? current.amountBamMinor : current.amountEurMinor)
        )
          fail(409, "PROMOTION_AMOUNT_MISMATCH");
        if (current.kind === "banner" && !current.hasImage) fail(409, "PROMOTION_IMAGE_REQUIRED");
        if (
          statement &&
          (
            await client.query(`SELECT id FROM promotion_order WHERE statement_reference=$1`, [
              statement,
            ])
          ).rowCount
        )
          fail(409, "PROMOTION_REFERENCE_USED");
        await client.query(
          `UPDATE promotion_order SET status='active',confirmed_by=$2,confirmed_at=clock_timestamp(),
          paid_amount_minor=$3,paid_currency=$4,statement_reference=$5 WHERE id=$1`,
          [orderId, actorId, value.amountMinor, value.currency, statement],
        );
        return { order: await order(client, orderId) };
      });
    },
    async prices(headers: Headers, input: unknown) {
      purchasing();
      const value = object(input, ["kind", "durationDays", "amountBamMinor"]);
      if (
        !isPromotionKind(value.kind) ||
        !isPromotionDuration(value.durationDays) ||
        !Number.isSafeInteger(value.amountBamMinor) ||
        Number(value.amountBamMinor) < 1 ||
        Number(value.amountBamMinor) > 100000000
      )
        fail(400, "INVALID_PROMOTION_PRICE");
      return run(headers, true, async (client, actorId) => {
        await client.query(
          `UPDATE promotion_price SET amount_bam_minor=$3,updated_by=$4,updated_at=clock_timestamp() WHERE kind=$1 AND duration_days=$2`,
          [value.kind, value.durationDays, value.amountBamMinor, actorId],
        );
        return { prices: await priceList(client) };
      });
    },
    async saveImage(headers: Headers, orderId: string, bytes: Uint8Array) {
      purchasing();
      id(orderId);
      // Check authority before decoding, then repeat it in the write transaction.
      await run(headers, false, async (client, actorId) => {
        const value = await order(client, orderId);
        const actor = (
          await client.query<{ role: string }>(`SELECT role FROM auth_user WHERE id=$1`, [actorId])
        ).rows[0];
        if (value.ownerId !== actorId && actor?.role !== "owner") fail(404, "PROMOTION_NOT_FOUND");
      });
      const image = await normalizeRasterImage(bytes, { width: 1600, height: 600, fit: "cover" });
      return run(headers, false, async (client, actorId) => {
        await client.query(`SELECT id FROM promotion_order WHERE id=$1 FOR UPDATE`, [orderId]);
        const value = await order(client, orderId);
        const actor = (
          await client.query<{ role: string }>(`SELECT role FROM auth_user WHERE id=$1`, [actorId])
        ).rows[0];
        if (value.ownerId !== actorId && actor?.role !== "owner") fail(404, "PROMOTION_NOT_FOUND");
        if (value.kind !== "banner" || value.status !== "pending")
          fail(409, "PROMOTION_ALREADY_PROCESSED");
        await client.query(
          `INSERT INTO promotion_banner_image(order_id,mime,bytes,width,height) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(order_id) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,width=excluded.width,height=excluded.height`,
          [orderId, image.mime, image.bytes, image.width, image.height],
        );
        return { order: await order(client, orderId) };
      });
    },
    async image(headers: Headers, orderId: string) {
      id(orderId);
      const publicImage = await pool.query<{ bytes: Buffer }>(
        `SELECT i.bytes FROM promotion_banner_image i JOIN promotion_order o ON o.id=i.order_id
        JOIN directory_business b ON b.id=o.business_id JOIN auth_user u ON u.id=b.owner_user_id
        WHERE o.id=$1 AND o.status='active' AND o.starts_at<=clock_timestamp() AND o.ends_at>clock_timestamp()
        AND b.owner_user_id=o.owner_id AND b.deleted_at IS NULL AND b.status='published' AND u.approval='approved' AND u."emailVerified"`,
        [orderId],
      );
      if (publicImage.rows[0]) return publicImage.rows[0].bytes;
      if (play) fail(404, "NOT_FOUND");
      return run(headers, false, async (client, actorId) => {
        const value = await order(client, orderId),
          actor = (
            await client.query<{ role: string }>(`SELECT role FROM auth_user WHERE id=$1`, [
              actorId,
            ])
          ).rows[0];
        if (value.ownerId !== actorId && actor?.role !== "owner") fail(404, "PROMOTION_NOT_FOUND");
        const image = (
          await client.query<{ bytes: Buffer }>(
            `SELECT bytes FROM promotion_banner_image WHERE order_id=$1`,
            [orderId],
          )
        ).rows[0];
        if (!image) fail(404, "PROMOTION_NOT_FOUND");
        return image.bytes;
      });
    },
  };
}
export type PromotionsService = ReturnType<typeof createPromotionsService>;
let shared: PromotionsService | undefined;
export function getPromotionsService() {
  if (shared) return shared;
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return null;
  shared = createPromotionsService({ auth, pool });
  return shared;
}
export { activePromotionSql, getActiveBanner } from "./read";
