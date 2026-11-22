import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { paypalOrderFlow } from "../../lib/paypal-order-flow";
import { hasActiveWalletPromotion } from "../marketing/category-promotion";
import {
  payableQuote,
  pendingQuoteOrder,
  reconcileProductionSale,
  settleOnlineQuote,
} from "../marketing/online-quote";

export type CheckoutActor = {
  userId: string;
  id: string;
  token: string;
  expectedAccountId?: string | null;
};
export type CheckoutEnvironment = "sandbox" | "live";
export type CheckoutOrder = {
  id: string;
  userId: string;
  quoteId: string | null;
  requestId: string;
  environment: CheckoutEnvironment;
  kind: "promotion" | "support" | "quote";
  businessId: string | null;
  categoryId: string | null;
  businessTitle: string | null;
  offerVersion: string;
  originalBamMinor: number | null;
  amountMinor: number;
  currency: "EUR";
  merchantId: string;
  status: string;
  providerOrderId: string | null;
  approvalUrl: string | null;
  captureId: string | null;
  createRequestId: string;
  captureRequestId: string;
  refundedMinor: number;
  refundTotalUnknown: boolean;
  startsAt: string | null;
  endsAt: string | null;
  expiresAt: string;
  capturedAt: string | null;
  version: number;
};
type HeldQuote = {
  businessId: string | null;
  businessVersion: number | null;
  revokedAt: string;
  userUpdatedAt: string;
};
export class CheckoutStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function fail(status: number, code: string): never {
  throw new CheckoutStoreError(status, code);
}
const uuid = (v: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v))
    fail(400, "INVALID_CHECKOUT_ID");
  return v;
};
const columns = `id,user_id AS "userId",request_id AS "requestId",environment,kind,quote_id AS "quoteId",business_id AS "businessId",category_id AS "categoryId",business_title AS "businessTitle",offer_version AS "offerVersion",original_bam_minor AS "originalBamMinor",amount_minor AS "amountMinor",currency,merchant_id AS "merchantId",status,provider_order_id AS "providerOrderId",approval_url AS "approvalUrl",capture_id AS "captureId",create_request_id AS "createRequestId",capture_request_id AS "captureRequestId",refunded_minor AS "refundedMinor",refund_total_unknown AS "refundTotalUnknown",starts_at::text AS "startsAt",ends_at::text AS "endsAt",expires_at::text AS "expiresAt",captured_at::text AS "capturedAt",version`;

export function promotionSql(alias = "b", includePayPal = true) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  const wallet = `EXISTS (SELECT 1 FROM wallet_category_promotion w JOIN auth_user u ON u.id=w.account_id
      WHERE w.business_id=${alias}.id AND w.account_id=${alias}.owner_user_id AND w.category_id=${alias}.category_id
        AND ${alias}.status='published' AND package_allows_listing(${alias}) AND u.approval='approved'
        AND u."emailVerified" AND u.role IN ('member','owner') AND w.revoked_at IS NULL AND w.starts_at<=now() AND w.ends_at>now())`;
  if (!includePayPal) return wallet;
  return `(EXISTS (SELECT 1 FROM paypal_promotion_entitlement pe JOIN paypal_checkout_order po ON po.id=pe.order_id JOIN auth_user pu ON pu.id=pe.user_id WHERE pe.business_id=${alias}.id AND pe.user_id=${alias}.owner_user_id AND pe.category_id=${alias}.category_id AND ${alias}.status='published' AND package_allows_listing(${alias}) AND pu.approval='approved' AND pu."emailVerified"=true AND pu.role IN ('member','owner') AND po.environment='live' AND po.status='captured' AND po.refunded_minor=0 AND po.refund_total_unknown=false AND pe.revoked_at IS NULL AND pe.starts_at<=now() AND pe.ends_at>now()) OR ${wallet})`;
}
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let begun = false;
  let discard = false;
  try {
    await client.query("BEGIN");
    begun = true;
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    const result = await action(client);
    await client.query("COMMIT");
    begun = false;
    return result;
  } catch (error) {
    if (begun)
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    throw error;
  } finally {
    client.release(discard);
  }
}
async function authority(c: PoolClient, a: CheckoutActor, owner = false) {
  const user = (
    await c.query<{ role: string; approval: string; emailVerified: boolean }>(
      'SELECT role,approval,"emailVerified" FROM auth_user WHERE id=$1 FOR UPDATE',
      [a.userId],
    )
  ).rows[0];
  if (
    user?.approval !== "approved" ||
    !user.emailVerified ||
    !["member", "owner"].includes(user.role)
  )
    fail(403, "ACCOUNT_ACCESS_DENIED");
  if (owner && user.role !== "owner") fail(403, "OWNER_REQUIRED");
  if (a.expectedAccountId && a.expectedAccountId !== a.userId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  const session = await c.query(
    'WITH s AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM s WHERE "expiresAt">clock_timestamp()',
    [a.id, a.userId, a.token],
  );
  if (session.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
}
async function row(c: PoolClient, id: string, lock = true) {
  const result = (
    await c.query<CheckoutOrder>(
      `SELECT ${columns} FROM paypal_checkout_order WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [uuid(id)],
    )
  ).rows[0];
  if (!result) fail(404, "ORDER_NOT_FOUND");
  return result;
}
async function business(c: PoolClient, id: string) {
  return (
    await c.query<{
      id: string;
      owner_user_id: string;
      category_id: string;
      title: string;
      status: string;
    }>(
      "SELECT id,owner_user_id,category_id,title, CASE WHEN package_allows_listing(b) THEN status ELSE 'draft' END AS status FROM directory_business b WHERE id=$1 AND b.deleted_at IS NULL FOR UPDATE",
      [uuid(id)],
    )
  ).rows[0];
}
async function cancellationCandidate(c: PoolClient, actor: CheckoutActor, id: string) {
  await authority(c, actor);
  const order = await row(c, id);
  if (order.userId !== actor.userId) fail(404, "ORDER_NOT_FOUND");
  if (
    order.kind !== "promotion" ||
    !order.businessId ||
    !order.providerOrderId ||
    order.captureId ||
    order.capturedAt ||
    order.startsAt ||
    order.endsAt ||
    order.refundedMinor !== 0 ||
    order.refundTotalUnknown ||
    !["provider_created", "cancelled"].includes(order.status)
  )
    fail(409, "ORDER_CANCELLATION_UNAVAILABLE");
  const owned = await business(c, order.businessId);
  if (owned?.owner_user_id !== actor.userId) fail(409, "ORDER_CANCELLATION_UNAVAILABLE");
  return order;
}
async function audit(c: PoolClient, id: string, action: string, details: unknown) {
  await c.query(
    "INSERT INTO paypal_checkout_event(id,order_id,action,details) VALUES($1,$2,$3,$4::jsonb)",
    [randomUUID(), id, action, JSON.stringify(details)],
  );
}
async function holdCapturedOrder(c: PoolClient, order: CheckoutOrder, commandId: string) {
  const quote =
    order.quoteId && order.environment === "live"
      ? ((
          await c.query<HeldQuote>(
            `UPDATE marketing_order q SET revoked_at=clock_timestamp()
           FROM auth_user u WHERE q.id=$1 AND q.online_checkout_id=$2 AND q.account_id=u.id
             AND q.status='paid' AND q.revoked_at IS NULL
             AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')
           RETURNING q.business_id AS "businessId", q.revoked_at::text AS "revokedAt",
             u."updatedAt"::text AS "userUpdatedAt",
             (SELECT version FROM directory_business WHERE id=q.business_id) AS "businessVersion"`,
            [order.quoteId, order.id],
          )
        ).rows[0] ?? null)
      : null;
  const held = await c.query<{ version: number }>(
    "UPDATE paypal_checkout_order SET status='review',updated_at=now(),version=version+1 WHERE id=$1 RETURNING version",
    [order.id],
  );
  const version = held.rows[0]?.version;
  if (!version) fail(404, "ORDER_NOT_FOUND");
  await audit(c, order.id, "refund_hold", { commandId, version, quote });
}

async function recoverRefundHold(c: PoolClient, order: CheckoutOrder) {
  if (
    order.status !== "review" ||
    !order.captureId ||
    order.refundedMinor !== 0 ||
    order.refundTotalUnknown
  )
    return order;
  const hold = (
    await c.query<{ quote: HeldQuote | null }>(
      `SELECT details->'quote' AS quote FROM paypal_checkout_event hold
       WHERE hold.order_id=$1 AND hold.action='refund_hold' AND hold.details->>'version'=$2
         AND EXISTS (SELECT 1 FROM paypal_refund_command command
           WHERE command.order_id=hold.order_id AND command.id::text=hold.details->>'commandId'
             AND command.status='failed' AND command.provider_refund_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM paypal_refund_command
           WHERE order_id=hold.order_id AND status IN ('reserved','completed'))
       LIMIT 1`,
      [order.id, String(order.version)],
    )
  ).rows[0];
  if (!hold) return order;
  if (order.businessId) {
    const listing = await business(c, order.businessId);
    if (
      !listing ||
      listing.owner_user_id !== order.userId ||
      listing.category_id !== order.categoryId ||
      listing.status !== "published" ||
      (order.environment === "live" && (await hasActiveWalletPromotion(c, order.businessId)))
    )
      return order;
    const entitled = await c.query(
      "SELECT 1 FROM paypal_promotion_entitlement WHERE order_id=$1 AND revoked_at IS NULL",
      [order.id],
    );
    if (!entitled.rowCount) return order;
  }
  if (order.quoteId && order.environment === "live") {
    const quote = hold.quote;
    if (!quote) return order;
    if (quote.businessId) await business(c, quote.businessId);
    const restored = await c.query(
      `UPDATE marketing_order q SET revoked_at=NULL
       WHERE q.id=$1 AND q.online_checkout_id=$2 AND q.account_id=$3 AND q.revoked_at=$4::timestamptz
         AND q.status='paid' AND q.business_id IS NOT DISTINCT FROM $5::uuid
         AND EXISTS (SELECT 1 FROM auth_user u WHERE u.id=q.account_id AND u."updatedAt"=$6::timestamptz)
         AND (q.kind='credits' OR EXISTS (
           SELECT 1 FROM directory_business b WHERE b.id=q.business_id AND b.version=$7
            AND b.owner_user_id=q.account_id AND b.deleted_at IS NULL
            AND CASE WHEN q.kind IN ('photo','video','photo_video') THEN b.status<>'archived'
              ELSE b.status='published' AND package_allows_listing(b) END))
         AND NOT EXISTS (SELECT 1 FROM marketing_order other WHERE other.id<>q.id
           AND other.business_id=q.business_id AND other.kind=q.kind
           AND other.campaign_key IS NOT DISTINCT FROM q.campaign_key
           AND other.status='paid' AND other.revoked_at IS NULL AND other.ends_at>now())`,
      [
        order.quoteId,
        order.id,
        order.userId,
        quote.revokedAt,
        quote.businessId,
        quote.userUpdatedAt,
        quote.businessVersion,
      ],
    );
    if (!restored.rowCount) return order;
  }
  await c.query(
    "UPDATE paypal_checkout_order SET status='captured',updated_at=now(),version=version+1 WHERE id=$1",
    [order.id],
  );
  await audit(c, order.id, "refund_hold_released", { captureId: order.captureId });
  return row(c, order.id);
}
async function requireCurrentPromotionBusiness(
  c: PoolClient,
  order: CheckoutOrder,
  actor: CheckoutActor,
) {
  if (order.quoteId) {
    const offer = await payableQuote(c, actor.userId, order.quoteId, true);
    if (
      !offer ||
      offer.amountMinor !== order.amountMinor ||
      offer.originalBamMinor !== order.originalBamMinor
    )
      fail(409, "QUOTE_NOT_PAYABLE");
  }
  if (!order.businessId) return;
  const b = await business(c, order.businessId);
  if (
    !b ||
    b.owner_user_id !== actor.userId ||
    b.category_id !== order.categoryId ||
    b.status !== "published"
  )
    fail(409, "BUSINESS_CHANGED");
}
async function event(c: PoolClient, o: CheckoutOrder, eventId?: string) {
  if (!eventId) return true;
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(eventId)) fail(400, "INVALID_EVENT_ID");
  const result = await c.query(
    "INSERT INTO paypal_webhook_event(environment,provider_event_id,order_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING order_id",
    [o.environment, eventId, o.id],
  );
  if (result.rowCount === 1) return true;
  const old = (
    await c.query<{ order_id: string }>(
      "SELECT order_id FROM paypal_webhook_event WHERE environment=$1 AND provider_event_id=$2",
      [o.environment, eventId],
    )
  ).rows[0];
  if (old?.order_id !== o.id) fail(409, "WEBHOOK_ORDER_CONFLICT");
  return false;
}
export function createCheckoutStore(pool: Pool) {
  return {
    async create(
      actor: CheckoutActor,
      input: {
        requestId: string;
        kind: "promotion" | "support" | "quote";
        businessId?: string;
        amountMinor?: number;
        quoteId?: string;
        merchantId: string;
        environment: CheckoutEnvironment;
        offerVersion: string;
      },
    ) {
      uuid(input.requestId);
      if (
        !["promotion", "support", "quote"].includes(input.kind) ||
        !["sandbox", "live"].includes(input.environment) ||
        (input.kind !== "quote" &&
          (!Number.isSafeInteger(input.amountMinor) ||
            (input.amountMinor ?? 0) < 1 ||
            (input.amountMinor ?? 0) > 1000000)) ||
        (input.kind === "quote") !== Boolean(input.quoteId) ||
        (input.kind === "quote" && input.amountMinor !== undefined) ||
        !input.merchantId ||
        !input.offerVersion
      )
        fail(400, "INVALID_CHECKOUT_INPUT");
      if ((input.kind === "promotion") !== Boolean(input.businessId))
        fail(400, "INVALID_CHECKOUT_INPUT");
      if (input.quoteId) uuid(input.quoteId);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            input.kind,
            input.businessId ?? null,
            input.amountMinor,
            input.merchantId,
            input.environment,
            input.offerVersion,
            ...(input.quoteId ? [input.quoteId] : []),
          ]),
        )
        .digest("hex");
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const existing = (
          await c.query<CheckoutOrder & { fingerprint: string }>(
            `SELECT ${columns},fingerprint FROM paypal_checkout_order WHERE user_id=$1 AND request_id=$2 FOR UPDATE`,
            [actor.userId, input.requestId],
          )
        ).rows[0];
        if (existing) {
          if (existing.fingerprint !== fingerprint) fail(409, "COMMAND_CONFLICT");
          return existing;
        }
        const quote = input.quoteId
          ? await payableQuote(c, actor.userId, input.quoteId, true)
          : null;
        if (input.quoteId && !quote) fail(409, "QUOTE_NOT_PAYABLE");
        const price = quote?.amountMinor ?? input.amountMinor;
        if (price === undefined) fail(400, "INVALID_CHECKOUT_INPUT");
        if (quote) {
          const pending = await pendingQuoteOrder(c, quote.id, input.environment);
          if (pending) {
            if (!["created", "provider_created"].includes(pending.status))
              fail(409, "QUOTE_PAYMENT_PENDING");
            const saved = await row(c, pending.id);
            if (saved.offerVersion !== input.offerVersion) fail(409, "CHECKOUT_FLOW_MISMATCH");
            if (
              saved.userId !== actor.userId ||
              saved.amountMinor !== price ||
              saved.merchantId !== input.merchantId
            )
              fail(409, "QUOTE_NOT_PAYABLE");
            return saved;
          }
        }
        let b: Awaited<ReturnType<typeof business>>;
        if (input.businessId) {
          b = await business(c, input.businessId);
          if (!b || b.owner_user_id !== actor.userId || b.status !== "published")
            fail(403, "BUSINESS_NOT_ELIGIBLE");
          if (input.environment === "live" && (await hasActiveWalletPromotion(c, b.id)))
            fail(409, "PROMOTION_ALREADY_RESERVED");
          const active = await c.query<CheckoutOrder & { fingerprint: string }>(
            `SELECT ${columns},fingerprint FROM paypal_checkout_order WHERE business_id=$1 AND environment=$2 AND ((status IN ('created','provider_created') AND expires_at>clock_timestamp()) OR (status='captured' AND ends_at>clock_timestamp()) OR status='review') ORDER BY id LIMIT 2`,
            [b.id, input.environment],
          );
          if (active.rowCount) {
            const candidate = active.rows[0];
            if (
              candidate?.userId === actor.userId &&
              ["created", "provider_created"].includes(candidate.status) &&
              paypalOrderFlow(candidate.offerVersion) !== paypalOrderFlow(input.offerVersion)
            )
              fail(409, "CHECKOUT_FLOW_MISMATCH");
            // Only resume the same owner's unchanged unpaid offer. Never reveal a
            // previous owner's order or treat a paid/review order as a new checkout.
            if (
              !candidate ||
              active.rows.length !== 1 ||
              candidate.userId !== actor.userId ||
              candidate.fingerprint !== fingerprint
            )
              fail(409, "PROMOTION_ALREADY_RESERVED");
            const pending = await row(c, candidate.id);
            const unexpired = await c.query(
              "SELECT id FROM paypal_checkout_order WHERE id=$1 AND expires_at>clock_timestamp()",
              [pending.id],
            );
            if (
              !["created", "provider_created"].includes(pending.status) ||
              pending.userId !== actor.userId ||
              pending.businessId !== b.id ||
              pending.categoryId !== b.category_id ||
              pending.kind !== input.kind ||
              pending.environment !== input.environment ||
              pending.offerVersion !== input.offerVersion ||
              pending.amountMinor !== input.amountMinor ||
              pending.merchantId !== input.merchantId ||
              pending.currency !== "EUR" ||
              pending.captureId !== null ||
              pending.refundedMinor !== 0 ||
              pending.refundTotalUnknown ||
              unexpired.rowCount !== 1
            )
              fail(409, "PROMOTION_ALREADY_RESERVED");
            return pending;
          }
        }
        const id = randomUUID();
        await c.query(
          "INSERT INTO paypal_checkout_order(id,user_id,request_id,fingerprint,environment,kind,business_id,category_id,business_title,offer_version,original_bam_minor,amount_minor,merchant_id,create_request_id,capture_request_id,quote_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
          [
            id,
            actor.userId,
            input.requestId,
            fingerprint,
            input.environment,
            input.kind,
            b?.id ?? null,
            b?.category_id ?? null,
            b?.title ?? quote?.title ?? null,
            input.offerVersion,
            quote?.originalBamMinor ?? (b ? 1000 : null),
            price,
            input.merchantId,
            randomUUID(),
            randomUUID(),
            quote?.id ?? null,
          ],
        );
        await audit(c, id, "created", {
          kind: input.kind,
          amountMinor: price,
          currency: "EUR",
        });
        return row(c, id);
      });
    },
    async read(actor: CheckoutActor, id: string) {
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const o = await row(c, id, false);
        if (o.userId !== actor.userId) fail(404, "ORDER_NOT_FOUND");
        return o;
      });
    },
    async readPendingPromotion(
      actor: CheckoutActor,
      businessId: string,
      environment: CheckoutEnvironment,
      merchantId: string,
    ) {
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const owned = await business(c, businessId);
        if (owned?.owner_user_id !== actor.userId) fail(404, "BUSINESS_NOT_FOUND");
        const active = await c.query<CheckoutOrder>(
          `SELECT ${columns} FROM paypal_checkout_order
           WHERE business_id=$1 AND user_id=$2 AND environment=$3 AND merchant_id=$4
             AND kind='promotion' AND status IN ('created','provider_created')
             AND capture_id IS NULL AND refunded_minor=0 AND refund_total_unknown=false
             AND expires_at>clock_timestamp()
           ORDER BY id LIMIT 2`,
          [businessId, actor.userId, environment, merchantId],
        );
        if (active.rows.length !== 1) return null;
        return active.rows[0] ?? null;
      });
    },
    async readPendingGuestCard(actor: CheckoutActor, id: string) {
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const order = await row(c, id);
        if (order.userId !== actor.userId) fail(404, "ORDER_NOT_FOUND");
        if (
          (order.kind !== "promotion" && order.kind !== "quote") ||
          (order.kind === "promotion" && !order.businessId) ||
          paypalOrderFlow(order.offerVersion) !== "guest" ||
          order.status !== "provider_created" ||
          !order.providerOrderId ||
          order.captureId ||
          (order.kind === "promotion" && order.amountMinor !== 511) ||
          order.currency !== "EUR" ||
          order.refundedMinor !== 0 ||
          order.refundTotalUnknown
        )
          fail(409, "ORDER_NOT_PAYABLE");
        await requireCurrentPromotionBusiness(c, order, actor);
        const available = await c.query(
          "SELECT id FROM paypal_checkout_order WHERE id=$1 AND expires_at>clock_timestamp() AND (capture_lease_until IS NULL OR capture_lease_until<clock_timestamp())",
          [id],
        );
        if (!available.rowCount) fail(409, "ORDER_BUSY_OR_EXPIRED");
        return order;
      });
    },
    async canCompleteApprovedPayment(actor: CheckoutActor, expected: CheckoutOrder) {
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const order = await row(c, expected.id);
        if (order.userId !== actor.userId) fail(404, "ORDER_NOT_FOUND");
        if (
          (order.kind !== "promotion" && order.kind !== "quote") ||
          (order.kind === "promotion" && !order.businessId) ||
          (order.kind === "quote" && !order.quoteId) ||
          !["guest", "sdk", "card-fields"].includes(paypalOrderFlow(order.offerVersion)) ||
          order.status !== "provider_created" ||
          !order.providerOrderId ||
          order.providerOrderId !== expected.providerOrderId ||
          order.version !== expected.version ||
          order.captureId ||
          order.refundedMinor !== 0 ||
          order.refundTotalUnknown
        )
          return false;
        try {
          await requireCurrentPromotionBusiness(c, order, actor);
        } catch (error) {
          if (
            error instanceof CheckoutStoreError &&
            ["QUOTE_NOT_PAYABLE", "BUSINESS_CHANGED"].includes(error.code)
          )
            return false;
          throw error;
        }
        if (
          order.environment === "live" &&
          order.businessId &&
          (await hasActiveWalletPromotion(c, order.businessId))
        )
          return false;
        const available = await c.query(
          "SELECT id FROM paypal_checkout_order WHERE id=$1 AND expires_at>clock_timestamp() AND (capture_lease_until IS NULL OR capture_lease_until<clock_timestamp())",
          [order.id],
        );
        return Boolean(available.rowCount);
      });
    },
    async cancelPromotion(
      actor: CheckoutActor,
      id: string,
      isUnpaid: (order: CheckoutOrder) => Promise<boolean>,
    ) {
      const pending = await transaction(pool, async (c) => {
        const order = await cancellationCandidate(c, actor, id);
        if (order.status === "cancelled") return order;
        const idle = await c.query(
          "SELECT id FROM paypal_checkout_order WHERE id=$1 AND capture_lease_until IS NULL",
          [id],
        );
        if (!idle.rowCount) fail(409, "ORDER_CANCELLATION_UNAVAILABLE");
        return order;
      });
      if (pending.status === "cancelled") return pending;
      if (!(await isUnpaid(pending))) fail(409, "ORDER_CANCELLATION_UNAVAILABLE");

      // Check ownership and state again after PayPal I/O. Even an expired capture lease
      // means that a charge may still be in flight or waiting to be reconciled.
      return transaction(pool, async (c) => {
        const current = await cancellationCandidate(c, actor, id);
        if (current.status === "cancelled") return current;
        const cancelled = await c.query(
          "UPDATE paypal_checkout_order SET status='cancelled',updated_at=now(),version=version+1 WHERE id=$1 AND version=$2 AND capture_lease_until IS NULL RETURNING id",
          [id, pending.version],
        );
        if (!cancelled.rowCount) fail(409, "ORDER_CANCELLATION_UNAVAILABLE");
        await audit(c, id, "cancelled_unpaid", {});
        return row(c, id);
      });
    },
    async prepareCapture(actor: CheckoutActor, id: string) {
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const o = await row(c, id);
        if (o.userId !== actor.userId) fail(404, "ORDER_NOT_FOUND");
        if (
          o.status === "captured" ||
          o.status === "partially_refunded" ||
          o.status === "refunded" ||
          o.status === "reversed"
        )
          return o;
        if (o.status !== "provider_created" || !o.providerOrderId) fail(409, "ORDER_NOT_PAYABLE");
        await requireCurrentPromotionBusiness(c, o, actor);
        const locked = await c.query(
          "UPDATE paypal_checkout_order SET capture_lease_until=now()+interval '60 seconds' WHERE id=$1 AND expires_at>now() AND (capture_lease_until IS NULL OR capture_lease_until<now()) RETURNING id",
          [id],
        );
        if (!locked.rowCount) fail(409, "ORDER_BUSY_OR_EXPIRED");
        return o;
      });
    },
    async attachProvider(
      id: string,
      value: { providerOrderId: string; approvalUrl: string | null },
    ) {
      return transaction(pool, async (c) => {
        if (!/^[A-Z0-9]{10,32}$/.test(value.providerOrderId)) fail(400, "INVALID_PROVIDER_ID");
        const o = await row(c, id);
        const url = value.approvalUrl === null ? null : new URL(value.approvalUrl);
        if (!url && !["sdk", "card-fields"].includes(paypalOrderFlow(o.offerVersion)))
          fail(400, "INVALID_APPROVAL_URL");
        if (
          url &&
          (url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.port ||
            url.hostname !==
              (o.environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com"))
        )
          fail(400, "INVALID_APPROVAL_URL");
        if (o.providerOrderId) {
          if (o.providerOrderId !== value.providerOrderId) fail(409, "PROVIDER_ORDER_CONFLICT");
          return o;
        }
        if (o.status !== "created") fail(409, "ORDER_NOT_PAYABLE");
        await c.query(
          "UPDATE paypal_checkout_order SET provider_order_id=$2,approval_url=$3,status='provider_created',updated_at=now(),version=version+1 WHERE id=$1",
          [id, value.providerOrderId, url?.href ?? null],
        );
        await audit(c, id, "provider_created", { providerOrderId: value.providerOrderId });
        return row(c, id);
      });
    },
    async settleCapture(
      id: string,
      value: {
        providerOrderId: string;
        captureId: string;
        merchantId: string;
        amountMinor: number;
        currency: "EUR";
        completedAt: string;
      },
      eventId?: string,
    ) {
      return transaction(pool, async (c) => {
        const hint = await row(c, id, false);
        const u = (
          await c.query<{ approval: string; emailVerified: boolean; role: string }>(
            'SELECT approval,"emailVerified",role FROM auth_user WHERE id=$1 FOR UPDATE',
            [hint.userId],
          )
        ).rows[0];
        const o = await row(c, id);
        if (
          o.providerOrderId !== value.providerOrderId ||
          o.merchantId !== value.merchantId ||
          o.amountMinor !== value.amountMinor ||
          value.currency !== "EUR" ||
          !value.captureId ||
          !Number.isFinite(Date.parse(value.completedAt))
        )
          fail(409, "CAPTURE_MISMATCH");
        if (o.captureId && o.captureId !== value.captureId) fail(409, "CAPTURE_CONFLICT");
        if (!(await event(c, o, eventId))) return o;
        if (o.captureId) {
          return u?.approval === "approved" &&
            u.emailVerified &&
            ["member", "owner"].includes(u.role)
            ? recoverRefundHold(c, o)
            : o;
        }
        let eligible = Boolean(
          !o.refundTotalUnknown &&
            o.status !== "review" &&
            o.status !== "cancelled" &&
            u &&
            u.approval === "approved" &&
            u.emailVerified &&
            ["member", "owner"].includes(u.role),
        );
        if (o.businessId) {
          const b = await business(c, o.businessId);
          eligible =
            eligible &&
            Boolean(
              b &&
                b.owner_user_id === o.userId &&
                b.category_id === o.categoryId &&
                b.status === "published" &&
                (o.environment !== "live" || !(await hasActiveWalletPromotion(c, b.id))),
            );
        }
        if (o.quoteId) {
          const listed = await c.query<{ business_id: string | null }>(
            "SELECT business_id FROM marketing_order WHERE id=$1",
            [o.quoteId],
          );
          if (listed.rows[0]?.business_id) await business(c, listed.rows[0].business_id);
          const offer = await payableQuote(c, o.userId, o.quoteId, true);
          eligible =
            eligible &&
            offer !== null &&
            offer.amountMinor === o.amountMinor &&
            offer.originalBamMinor === o.originalBamMinor;
        }
        // Late payment is recorded for review/refund, never granted over a newer reservation.
        const timely = await c.query(
          "SELECT id FROM paypal_checkout_order WHERE id=$1 AND expires_at>now()",
          [id],
        );
        eligible = eligible && Boolean(timely.rowCount);
        const status = eligible ? "captured" : "review";
        await c.query(
          "UPDATE paypal_checkout_order SET capture_id=$2,captured_at=$3,status=$4,starts_at=CASE WHEN kind='promotion' AND $4='captured' THEN now() ELSE NULL END,ends_at=CASE WHEN kind='promotion' AND $4='captured' THEN now()+interval '7 days' ELSE NULL END,capture_lease_until=NULL,updated_at=now(),version=version+1 WHERE id=$1",
          [id, value.captureId, value.completedAt, status],
        );
        if (eligible && o.kind === "promotion")
          await c.query(
            "INSERT INTO paypal_promotion_entitlement(order_id,business_id,user_id,category_id,starts_at,ends_at) SELECT id,business_id,user_id,category_id,starts_at,ends_at FROM paypal_checkout_order WHERE id=$1 ON CONFLICT DO NOTHING",
            [id],
          );
        if (eligible && o.quoteId && o.environment === "live")
          await settleOnlineQuote(c, o.userId, o.quoteId, o.id);
        await audit(c, id, "capture_confirmed", { captureId: value.captureId, status });
        return row(c, id);
      });
    },
    async settleRefundedCapture(
      id: string,
      value: {
        providerOrderId: string;
        captureId: string;
        merchantId: string;
        amountMinor: number;
        currency: "EUR";
        completedAt: string;
      },
      refund: { refundedMinor: number | null; reversed?: boolean },
      eventId?: string,
    ) {
      return transaction(pool, async (c) => {
        const o = await row(c, id);
        if (
          o.providerOrderId !== value.providerOrderId ||
          o.merchantId !== value.merchantId ||
          o.amountMinor !== value.amountMinor ||
          value.currency !== "EUR" ||
          !value.captureId ||
          !Number.isFinite(Date.parse(value.completedAt))
        )
          fail(409, "CAPTURE_MISMATCH");
        if (o.captureId && o.captureId !== value.captureId) fail(409, "CAPTURE_CONFLICT");
        if (
          refund.refundedMinor !== null &&
          (!Number.isSafeInteger(refund.refundedMinor) ||
            refund.refundedMinor < 0 ||
            refund.refundedMinor > o.amountMinor)
        )
          fail(409, "REFUND_MISMATCH");
        if (!(await event(c, o, eventId))) return o;
        const total = Math.max(o.refundedMinor, refund.refundedMinor ?? 0);
        const status =
          refund.reversed || o.status === "reversed"
            ? "reversed"
            : total === o.amountMinor
              ? "refunded"
              : refund.refundedMinor === null
                ? "review"
                : total > 0
                  ? "partially_refunded"
                  : "review";
        await c.query(
          "UPDATE paypal_checkout_order SET capture_id=COALESCE(capture_id,$2),captured_at=COALESCE(captured_at,$3),refunded_minor=$4,refund_total_unknown=$5,status=$6,capture_lease_until=NULL,updated_at=now(),version=version+1 WHERE id=$1",
          [
            id,
            value.captureId,
            value.completedAt,
            total,
            refund.refundedMinor === null && (o.refundTotalUnknown || total < o.amountMinor),
            status,
          ],
        );
        await c.query(
          "UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,$2) WHERE order_id=$1",
          [id, status],
        );
        if (o.quoteId && o.environment === "live")
          await reconcileProductionSale(
            c,
            o.quoteId,
            o.id,
            o.captureId === null && o.status !== "review" && !o.refundTotalUnknown,
          );
        await audit(c, id, "refunded_capture_reconciled", {
          captureId: value.captureId,
          refundedMinor: refund.refundedMinor,
          status,
        });
        return row(c, id);
      });
    },
    async reconcileRefund(
      id: string,
      value: {
        captureId: string;
        refundedMinor: number;
        refundTotalUnknown?: false;
        reversed?: boolean;
      },
      eventId?: string,
    ) {
      return transaction(pool, async (c) => {
        const o = await row(c, id);
        if (
          o.captureId !== value.captureId ||
          !Number.isSafeInteger(value.refundedMinor) ||
          value.refundedMinor < 0 ||
          value.refundedMinor > o.amountMinor
        )
          fail(409, "REFUND_MISMATCH");
        if (!(await event(c, o, eventId))) return o;
        const total = Math.max(o.refundedMinor, value.refundedMinor);
        const status =
          value.reversed || o.status === "reversed"
            ? "reversed"
            : total === o.amountMinor
              ? "refunded"
              : total > 0
                ? "partially_refunded"
                : o.status;
        await c.query(
          "UPDATE paypal_checkout_order SET refunded_minor=$2,refund_total_unknown=false,status=$3,capture_lease_until=NULL,updated_at=now(),version=version+1 WHERE id=$1",
          [id, total, status],
        );
        if (total > 0 || status === "reversed")
          await c.query(
            "UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,$2) WHERE order_id=$1",
            [id, status],
          );
        if (o.quoteId && o.environment === "live")
          await reconcileProductionSale(c, o.quoteId, o.id, false);
        await audit(c, id, "refund_reconciled", { refundedMinor: total, status });
        return row(c, id);
      });
    },
    async reserveRefund(
      actor: CheckoutActor,
      id: string,
      input: { requestId: string; amountMinor: number; reason: string },
    ) {
      return transaction(pool, async (c) => {
        uuid(input.requestId);
        if (
          !Number.isSafeInteger(input.amountMinor) ||
          input.amountMinor < 1 ||
          input.reason.trim().length < 2 ||
          input.reason.length > 500
        )
          fail(400, "INVALID_REFUND_INPUT");
        await authority(c, actor, true);
        const o = await row(c, id);
        const old = (
          await c.query(
            "SELECT id,order_id,amount_minor,reason,provider_request_id,status FROM paypal_refund_command WHERE actor_user_id=$1 AND request_id=$2 FOR UPDATE",
            [actor.userId, input.requestId],
          )
        ).rows[0];
        if (old) {
          if (
            old.order_id !== id ||
            old.amount_minor !== input.amountMinor ||
            old.reason !== input.reason.trim()
          )
            fail(409, "COMMAND_CONFLICT");
          return {
            id: String(old.id),
            order: o,
            amountMinor: Number(old.amount_minor),
            providerRequestId: String(old.provider_request_id),
            status: String(old.status),
          };
        }
        if (
          o.refundTotalUnknown ||
          !o.captureId ||
          !["captured", "review", "partially_refunded"].includes(o.status)
        )
          fail(409, "ORDER_NOT_REFUNDABLE");
        const pending = (
          await c.query<{ total: string }>(
            "SELECT COALESCE(sum(amount_minor),0)::text AS total FROM paypal_refund_command WHERE order_id=$1 AND status='reserved'",
            [id],
          )
        ).rows[0];
        if (input.amountMinor > o.amountMinor - o.refundedMinor - Number(pending?.total ?? 0))
          fail(409, "REFUND_EXCEEDS_REMAINING");
        const commandId = randomUUID(),
          providerRequestId = randomUUID();
        await c.query(
          "INSERT INTO paypal_refund_command(id,order_id,actor_user_id,request_id,provider_request_id,amount_minor,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            commandId,
            id,
            actor.userId,
            input.requestId,
            providerRequestId,
            input.amountMinor,
            input.reason.trim(),
          ],
        );
        await audit(c, id, "refund_reserved", {
          commandId,
          amountMinor: input.amountMinor,
          reason: input.reason.trim(),
        });
        return {
          id: commandId,
          order: o,
          amountMinor: input.amountMinor,
          providerRequestId,
          status: "reserved",
        };
      });
    },
    async readSystem(id: string) {
      return transaction(pool, (c) => row(c, id, false));
    },
    async findByProvider(
      environment: CheckoutEnvironment,
      input: { providerOrderId?: string; captureId?: string },
    ) {
      if (!input.providerOrderId && !input.captureId) fail(400, "INVALID_PROVIDER_LOOKUP");
      return (
        (
          await pool.query<CheckoutOrder>(
            `SELECT ${columns} FROM paypal_checkout_order WHERE environment=$1 AND ($2::text IS NULL OR provider_order_id=$2) AND ($3::text IS NULL OR capture_id=$3)`,
            [environment, input.providerOrderId ?? null, input.captureId ?? null],
          )
        ).rows[0] ?? null
      );
    },
    async markReview(id: string, eventId?: string) {
      return transaction(pool, async (c) => {
        const o = await row(c, id);
        if (!(await event(c, o, eventId))) return o;
        await c.query(
          "UPDATE paypal_checkout_order SET status=CASE WHEN status IN ('refunded','reversed') THEN status ELSE 'review' END,refund_total_unknown=true,updated_at=now(),version=version+1 WHERE id=$1",
          [id],
        );
        await c.query(
          "UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'review_required') WHERE order_id=$1",
          [id],
        );
        await audit(c, id, "review_required", {});
        return row(c, id);
      });
    },
    async listPendingRefunds(environment: CheckoutEnvironment, limit = 50, afterId?: string) {
      if (afterId) uuid(afterId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "INVALID_LIMIT");
      return (
        await pool.query<{
          id: string;
          orderId: string;
          providerRefundId: string | null;
          providerRequestId: string;
          amountMinor: number;
        }>(
          `SELECT r.id,r.order_id AS "orderId",r.provider_refund_id AS "providerRefundId",r.provider_request_id AS "providerRequestId",r.amount_minor AS "amountMinor" FROM paypal_refund_command r JOIN paypal_checkout_order o ON o.id=r.order_id WHERE r.status='reserved' AND r.provider_refund_id IS NOT NULL AND o.environment=$1 AND ($3::uuid IS NULL OR r.id>$3::uuid) ORDER BY r.id LIMIT $2`,
          [environment, limit, afterId ?? null],
        )
      ).rows;
    },
    async findRefundByProvider(environment: CheckoutEnvironment, refundId: string) {
      return (
        (
          await pool.query<{ id: string; orderId: string; amountMinor: number }>(
            `SELECT r.id,r.order_id AS "orderId",r.amount_minor AS "amountMinor"
           FROM paypal_refund_command r JOIN paypal_checkout_order o ON o.id=r.order_id
           WHERE o.environment=$1 AND r.provider_refund_id=$2`,
            [environment, refundId],
          )
        ).rows[0] ?? null
      );
    },
    async attachRefundResult(
      commandId: string,
      value: {
        refundId: string;
        status: "COMPLETED" | "PENDING" | "FAILED";
        amountMinor: number;
        captureId: string;
      },
    ) {
      return transaction(pool, async (c) => {
        uuid(commandId);
        const hint = (
          await c.query<{ order_id: string }>(
            "SELECT order_id FROM paypal_refund_command WHERE id=$1",
            [commandId],
          )
        ).rows[0];
        if (!hint) fail(404, "REFUND_NOT_FOUND");
        const o = await row(c, hint.order_id);
        const command = (
          await c.query<{
            status: string;
            provider_refund_id: string | null;
            amount_minor: number;
          }>(
            "SELECT status,provider_refund_id,amount_minor FROM paypal_refund_command WHERE id=$1 FOR UPDATE",
            [commandId],
          )
        ).rows[0];
        if (
          !command ||
          o.captureId !== value.captureId ||
          command.amount_minor !== value.amountMinor ||
          !value.refundId ||
          (command.provider_refund_id && command.provider_refund_id !== value.refundId)
        )
          fail(409, "REFUND_MISMATCH");
        if (
          command.status === "completed" ||
          (command.status === "failed" && value.status !== "COMPLETED") ||
          (command.provider_refund_id && value.status === "PENDING")
        )
          return o;
        const status =
          value.status === "COMPLETED"
            ? "completed"
            : value.status === "FAILED"
              ? "failed"
              : "reserved";
        await c.query(
          "UPDATE paypal_refund_command SET status=$2,provider_refund_id=$3 WHERE id=$1",
          [commandId, status, value.refundId],
        );
        if (value.status === "PENDING") {
          if (o.status === "captured" && o.refundedMinor === 0 && !o.refundTotalUnknown) {
            // Checkout status suspends visibility. Keep independent promotion revocations writable.
            await holdCapturedOrder(c, o, commandId);
          } else if (o.status === "captured" || o.status === "partially_refunded") {
            // A second pending refund keeps an already-corrected purchase on review.
            await c.query(
              "UPDATE paypal_checkout_order SET status='review',updated_at=now(),version=version+1 WHERE id=$1",
              [o.id],
            );
          }
        } else if (value.status === "COMPLETED") {
          await c.query(
            "UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'refund_requested') WHERE order_id=$1",
            [o.id],
          );
          const total = Number(
            (
              await c.query<{ total: string }>(
                "SELECT sum(amount_minor)::text AS total FROM paypal_refund_command WHERE order_id=$1 AND status='completed'",
                [o.id],
              )
            ).rows[0]?.total ?? 0,
          );
          if (total > o.amountMinor) fail(409, "REFUND_EXCEEDS_REMAINING");
          const refunded = Math.max(total, o.refundedMinor);
          const unknown =
            refunded < o.amountMinor &&
            (o.refundTotalUnknown || o.refundedMinor > total - value.amountMinor);
          await c.query(
            "UPDATE paypal_checkout_order SET refunded_minor=$2,refund_total_unknown=$3,status=CASE WHEN status='reversed' THEN status WHEN $2=amount_minor THEN 'refunded' WHEN $3 THEN 'review' ELSE 'partially_refunded' END,updated_at=now(),version=version+1 WHERE id=$1",
            [o.id, refunded, unknown],
          );
          if (o.quoteId && o.environment === "live")
            await reconcileProductionSale(c, o.quoteId, o.id, false);
        }
        await audit(c, o.id, "refund_result", { commandId, refundId: value.refundId, status });
        return row(c, o.id);
      });
    },
    async listReconciliation(environment: CheckoutEnvironment, limit = 50, afterId?: string) {
      if (afterId) uuid(afterId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "INVALID_LIMIT");
      return (
        await pool.query<CheckoutOrder>(
          // PayPal permits up to 72 hours to capture an order. Manual and webhook
          // reconciliation still resolve cancelled orders by their saved identity.
          `SELECT ${columns} FROM paypal_checkout_order
           WHERE environment=$1 AND provider_order_id IS NOT NULL
             AND status NOT IN ('refunded','reversed')
             AND (status<>'cancelled' OR updated_at>=now()-interval '72 hours')
             AND ($3::uuid IS NULL OR id>$3::uuid)
           ORDER BY id LIMIT $2`,
          [environment, limit, afterId ?? null],
        )
      ).rows;
    },
    async findProvider(environment: CheckoutEnvironment, providerOrderId: string) {
      return (
        (
          await pool.query<CheckoutOrder>(
            `SELECT ${columns} FROM paypal_checkout_order WHERE environment=$1 AND provider_order_id=$2`,
            [environment, providerOrderId],
          )
        ).rows[0] ?? null
      );
    },
  };
}
