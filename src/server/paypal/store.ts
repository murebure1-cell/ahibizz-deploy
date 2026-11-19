import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { paypalOrderFlow } from "../../lib/paypal-order-flow";

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
  requestId: string;
  environment: CheckoutEnvironment;
  kind: "promotion" | "support";
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
const columns = `id,user_id AS "userId",request_id AS "requestId",environment,kind,business_id AS "businessId",category_id AS "categoryId",business_title AS "businessTitle",offer_version AS "offerVersion",original_bam_minor AS "originalBamMinor",amount_minor AS "amountMinor",currency,merchant_id AS "merchantId",status,provider_order_id AS "providerOrderId",approval_url AS "approvalUrl",capture_id AS "captureId",create_request_id AS "createRequestId",capture_request_id AS "captureRequestId",refunded_minor AS "refundedMinor",refund_total_unknown AS "refundTotalUnknown",starts_at::text AS "startsAt",ends_at::text AS "endsAt",expires_at::text AS "expiresAt",captured_at::text AS "capturedAt",version`;

export function promotionSql(alias = "b") {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  return `EXISTS (SELECT 1 FROM paypal_promotion_entitlement pe JOIN paypal_checkout_order po ON po.id=pe.order_id JOIN auth_user pu ON pu.id=pe.user_id WHERE pe.business_id=${alias}.id AND pe.user_id=${alias}.owner_user_id AND pe.category_id=${alias}.category_id AND ${alias}.status='published' AND pu.approval='approved' AND pu."emailVerified"=true AND pu.role IN ('member','owner') AND po.environment='live' AND po.status='captured' AND po.refunded_minor=0 AND po.refund_total_unknown=false AND pe.revoked_at IS NULL AND pe.starts_at<=now() AND pe.ends_at>now())`;
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
      "SELECT id,owner_user_id,category_id,title,status FROM directory_business WHERE id=$1 FOR UPDATE",
      [uuid(id)],
    )
  ).rows[0];
}
async function audit(c: PoolClient, id: string, action: string, details: unknown) {
  await c.query(
    "INSERT INTO paypal_checkout_event(id,order_id,action,details) VALUES($1,$2,$3,$4::jsonb)",
    [randomUUID(), id, action, JSON.stringify(details)],
  );
}
async function requireCurrentPromotionBusiness(
  c: PoolClient,
  order: CheckoutOrder,
  actor: CheckoutActor,
) {
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
        kind: "promotion" | "support";
        businessId?: string;
        amountMinor: number;
        merchantId: string;
        environment: CheckoutEnvironment;
        offerVersion: string;
      },
    ) {
      uuid(input.requestId);
      if (
        !["promotion", "support"].includes(input.kind) ||
        !["sandbox", "live"].includes(input.environment) ||
        !Number.isSafeInteger(input.amountMinor) ||
        input.amountMinor < 1 ||
        input.amountMinor > 1000000 ||
        !input.merchantId ||
        !input.offerVersion
      )
        fail(400, "INVALID_CHECKOUT_INPUT");
      if ((input.kind === "promotion") !== Boolean(input.businessId))
        fail(400, "INVALID_CHECKOUT_INPUT");
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            input.kind,
            input.businessId ?? null,
            input.amountMinor,
            input.merchantId,
            input.environment,
            input.offerVersion,
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
        let b: Awaited<ReturnType<typeof business>>;
        if (input.businessId) {
          b = await business(c, input.businessId);
          if (!b || b.owner_user_id !== actor.userId || b.status !== "published")
            fail(403, "BUSINESS_NOT_ELIGIBLE");
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
          "INSERT INTO paypal_checkout_order(id,user_id,request_id,fingerprint,environment,kind,business_id,category_id,business_title,offer_version,original_bam_minor,amount_minor,merchant_id,create_request_id,capture_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
          [
            id,
            actor.userId,
            input.requestId,
            fingerprint,
            input.environment,
            input.kind,
            b?.id ?? null,
            b?.category_id ?? null,
            b?.title ?? null,
            input.offerVersion,
            b ? 1000 : null,
            input.amountMinor,
            input.merchantId,
            randomUUID(),
            randomUUID(),
          ],
        );
        await audit(c, id, "created", {
          kind: input.kind,
          amountMinor: input.amountMinor,
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
    async readPendingGuestCard(actor: CheckoutActor, id: string) {
      return transaction(pool, async (c) => {
        await authority(c, actor);
        const order = await row(c, id);
        if (order.userId !== actor.userId) fail(404, "ORDER_NOT_FOUND");
        if (
          order.kind !== "promotion" ||
          !order.businessId ||
          paypalOrderFlow(order.offerVersion) !== "guest" ||
          order.status !== "provider_created" ||
          !order.providerOrderId ||
          order.captureId ||
          order.amountMinor !== 511 ||
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
        if (!url && paypalOrderFlow(o.offerVersion) !== "sdk") fail(400, "INVALID_APPROVAL_URL");
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
        if (o.captureId) return o;
        let eligible = Boolean(
          !o.refundTotalUnknown &&
            o.status !== "review" &&
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
                b.status === "published",
            );
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
          [id, value.captureId, value.completedAt, total, refund.refundedMinor === null, status],
        );
        await c.query(
          "UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,$2) WHERE order_id=$1",
          [id, status],
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
        if (command.status === "completed") return o;
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
          await c.query(
            "UPDATE paypal_checkout_order SET status=CASE WHEN status IN ('refunded','reversed') THEN status ELSE 'review' END,updated_at=now(),version=version+1 WHERE id=$1",
            [o.id],
          );
        }
        if (value.status !== "FAILED") {
          await c.query(
            "UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'refund_requested') WHERE order_id=$1",
            [o.id],
          );
          if (value.status === "COMPLETED") {
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
          }
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
          `SELECT ${columns} FROM paypal_checkout_order WHERE environment=$1 AND provider_order_id IS NOT NULL AND status NOT IN ('refunded','reversed','cancelled') AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $2`,
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
