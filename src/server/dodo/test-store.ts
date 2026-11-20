import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CheckoutActor } from "../paypal/store";
import type { DodoTestPersistence, DodoTestSession } from "./test-adapter";
export type DodoOrder = {
  id: string;
  userId: string;
  requestId: string;
  businessId: string;
  categoryId: string;
  merchantId: string;
  productId: string;
  environment: "test_mode";
  purpose: "promotion";
  amountMinor: 511;
  currency: "EUR";
  status: string;
  sessionId: string | null;
  checkoutUrl: string | null;
  paymentId: string | null;
  testStartsAt: string | null;
  testEndsAt: string | null;
};
export class DodoStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function fail(status: number, code: string): never {
  throw new DodoStoreError(status, code);
}
function uuid(v: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v))
    fail(400, "DODO_INVALID_ID");
  return v;
}
const columns = `id,user_id AS "userId",request_id AS "requestId",business_id AS "businessId",category_id AS "categoryId",merchant_id AS "merchantId",product_id AS "productId",environment,purpose,amount_minor AS "amountMinor",currency,status,session_id AS "sessionId",checkout_url AS "checkoutUrl",payment_id AS "paymentId",test_starts_at::text AS "testStartsAt",test_ends_at::text AS "testEndsAt"`;
async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='3s'");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function auth(c: PoolClient, a: CheckoutActor) {
  const u = (
    await c.query<{ approval: string; emailVerified: boolean; role: string }>(
      'SELECT approval,"emailVerified",role FROM auth_user WHERE id=$1 FOR UPDATE',
      [a.userId],
    )
  ).rows[0];
  if (u?.approval !== "approved" || !u.emailVerified || !["member", "owner"].includes(u.role))
    fail(403, "DODO_ACCOUNT_DENIED");
  if (a.expectedAccountId && a.expectedAccountId !== a.userId) fail(401, "DODO_ACCOUNT_CHANGED");
  const s = await c.query(
    'WITH s AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM s WHERE "expiresAt">clock_timestamp()',
    [a.id, a.userId, a.token],
  );
  if (s.rowCount !== 1) fail(401, "DODO_AUTH_REQUIRED");
}
async function row(c: PoolClient, id: string) {
  const o = (
    await c.query<DodoOrder>(`SELECT ${columns} FROM dodo_test_order WHERE id=$1 FOR UPDATE`, [
      uuid(id),
    ])
  ).rows[0];
  if (!o) fail(404, "DODO_ORDER_NOT_FOUND");
  return o;
}
async function eligible(c: PoolClient, o: DodoOrder) {
  const b = (
    await c.query<{ owner_user_id: string; category_id: string; status: string }>(
      "SELECT owner_user_id,category_id, CASE WHEN package_allows_listing(b) THEN status ELSE 'draft' END AS status FROM directory_business b WHERE id=$1 FOR UPDATE",
      [o.businessId],
    )
  ).rows[0];
  return (
    b?.owner_user_id === o.userId && b.category_id === o.categoryId && b.status === "published"
  );
}
function limitCheck(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "DODO_INVALID_LIMIT");
}
export function createDodoTestStore(pool: Pool) {
  async function putVerifiedEvent(namespace: string, eventId: string, raw: string, hash: string) {
    if (
      !/^dodo:test_mode:[A-Za-z0-9_-]{1,128}$/.test(namespace) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(eventId) ||
      Buffer.byteLength(raw) > 131072 ||
      createHash("sha256").update(raw).digest("hex") !== hash
    )
      fail(400, "DODO_INVALID_INBOX");
    return tx(pool, async (c) => {
      const inserted = await c.query(
        "INSERT INTO dodo_test_inbox(namespace,event_id,raw,hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
        [namespace, eventId, raw, hash],
      );
      if (inserted.rowCount === 1) return true;
      const old = (
        await c.query<{ hash: string }>(
          "SELECT hash FROM dodo_test_inbox WHERE namespace=$1 AND event_id=$2",
          [namespace, eventId],
        )
      ).rows[0];
      if (old?.hash !== hash) fail(409, "DODO_EVENT_CONFLICT");
      return false;
    });
  }
  const persistence: DodoTestPersistence = {
    putVerifiedEvent,
    async createOnce() {
      return fail(403, "DODO_SCOPED_PERSISTENCE_REQUIRED");
    },
  };
  return {
    persistence,
    async create(
      actor: CheckoutActor,
      input: { requestId: string; businessId: string; merchantId: string; productId: string },
    ) {
      uuid(input.requestId);
      uuid(input.businessId);
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(input.merchantId) ||
        !/^pdt_[A-Za-z0-9_-]{1,100}$/.test(input.productId)
      )
        fail(400, "DODO_INVALID_PRODUCT");
      return tx(pool, async (c) => {
        await auth(c, actor);
        const old = (
          await c.query<DodoOrder>(
            `SELECT ${columns} FROM dodo_test_order WHERE user_id=$1 AND request_id=$2`,
            [actor.userId, input.requestId],
          )
        ).rows[0];
        if (old) {
          if (
            old.businessId !== input.businessId ||
            old.merchantId !== input.merchantId ||
            old.productId !== input.productId
          )
            fail(409, "DODO_REQUEST_CONFLICT");
          return old;
        }
        const b = (
          await c.query<{ owner_user_id: string; category_id: string; status: string }>(
            "SELECT owner_user_id,category_id, CASE WHEN package_allows_listing(b) THEN status ELSE 'draft' END AS status FROM directory_business b WHERE id=$1 FOR UPDATE",
            [input.businessId],
          )
        ).rows[0];
        if (b?.owner_user_id !== actor.userId || b.status !== "published")
          fail(403, "DODO_BUSINESS_DENIED");
        const id = randomUUID();
        await c.query(
          "INSERT INTO dodo_test_order(id,user_id,request_id,business_id,category_id,merchant_id,product_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            actor.userId,
            input.requestId,
            input.businessId,
            b.category_id,
            input.merchantId,
            input.productId,
          ],
        );
        return row(c, id);
      });
    },
    async read(actor: CheckoutActor, id: string) {
      return tx(pool, async (c) => {
        await auth(c, actor);
        const o = await row(c, id);
        if (o.userId !== actor.userId) fail(404, "DODO_ORDER_NOT_FOUND");
        return o;
      });
    },
    async readSystem(id: string) {
      return tx(pool, (c) => row(c, id));
    },
    scopedPersistence(actor: CheckoutActor, id: string): DodoTestPersistence {
      return {
        putVerifiedEvent,
        async createOnce(namespace, key, fingerprint, sendOnce) {
          const saved = await tx(pool, async (c) => {
            await auth(c, actor);
            const o = await row(c, id);
            if (o.userId !== actor.userId || !(await eligible(c, o)))
              fail(403, "DODO_BUSINESS_DENIED");
            if (
              namespace !== `dodo:test_mode:${o.merchantId}` ||
              key !== o.requestId ||
              !/^[a-f0-9]{64}$/.test(fingerprint)
            )
              fail(409, "DODO_COMMAND_MISMATCH");
            const prior = (
              await c.query<{ fingerprint: string; status: string; result: DodoTestSession }>(
                "SELECT fingerprint,status,result FROM dodo_test_command WHERE namespace=$1 AND command_key=$2 FOR UPDATE",
                [namespace, key],
              )
            ).rows[0];
            if (prior) {
              if (prior.fingerprint !== fingerprint) fail(409, "DODO_REQUEST_CONFLICT");
              if (prior.status === "completed") return prior.result;
              fail(409, "DODO_CREATE_AMBIGUOUS");
            }
            const fresh = await c.query(
              "SELECT id FROM dodo_test_order WHERE id=$1 AND status='created' AND expires_at>clock_timestamp()",
              [id],
            );
            if (fresh.rowCount !== 1) fail(409, "DODO_ORDER_NOT_CREATABLE");
            await c.query(
              "INSERT INTO dodo_test_command(namespace,command_key,order_id,fingerprint,status) VALUES($1,$2,$3,$4,'reserved')",
              [namespace, key, id, fingerprint],
            );
            await c.query("UPDATE dodo_test_order SET status='reserved' WHERE id=$1", [id]);
            return null;
          });
          if (saved) return saved;
          try {
            const result = await sendOnce();
            if (
              !/^cks_[A-Za-z0-9_-]{1,100}$/.test(result.sessionId) ||
              result.checkoutUrl !==
                `https://test.checkout.dodopayments.com/session/${result.sessionId}`
            )
              fail(502, "DODO_INVALID_SESSION");
            await tx(pool, async (c) => {
              await row(c, id);
              await c.query(
                "UPDATE dodo_test_command SET status='completed',result=$3::jsonb WHERE namespace=$1 AND command_key=$2 AND status='reserved'",
                [namespace, key, JSON.stringify(result)],
              );
              await c.query(
                "UPDATE dodo_test_order SET session_id=$2,checkout_url=$3,status=CASE WHEN status='review' THEN status ELSE 'provider_created' END WHERE id=$1",
                [id, result.sessionId, result.checkoutUrl],
              );
            });
            return result;
          } catch (error) {
            await tx(pool, async (c) => {
              await row(c, id);
              await c.query(
                "UPDATE dodo_test_command SET status='ambiguous' WHERE namespace=$1 AND command_key=$2 AND status='reserved'",
                [namespace, key],
              );
              await c.query(
                "UPDATE dodo_test_order SET status='ambiguous' WHERE id=$1 AND status='reserved'",
                [id],
              );
            });
            throw error;
          }
        },
      };
    },
    async settleVerified(
      id: string,
      proof: {
        merchantId: string;
        productId: string;
        sessionId: string;
        provider: "dodo";
        environment: "test_mode";
        orderId: string;
        paymentId: string;
        amountMinor: 511;
        currency: "EUR";
        status: "succeeded";
      },
    ) {
      return tx(pool, async (c) => {
        const hint = (
          await c.query<{ user_id: string }>("SELECT user_id FROM dodo_test_order WHERE id=$1", [
            uuid(id),
          ])
        ).rows[0];
        if (!hint) fail(404, "DODO_ORDER_NOT_FOUND");
        const u = (
          await c.query<{ approval: string; emailVerified: boolean; role: string }>(
            'SELECT approval,"emailVerified",role FROM auth_user WHERE id=$1 FOR UPDATE',
            [hint.user_id],
          )
        ).rows[0];
        const o = await row(c, id);
        if (
          proof.merchantId !== o.merchantId ||
          proof.productId !== o.productId ||
          proof.sessionId !== o.sessionId ||
          !o.sessionId ||
          proof.provider !== "dodo" ||
          proof.environment !== "test_mode" ||
          proof.orderId !== id ||
          proof.amountMinor !== 511 ||
          proof.currency !== "EUR" ||
          proof.status !== "succeeded" ||
          !/^pay_[A-Za-z0-9_-]{1,100}$/.test(proof.paymentId) ||
          (o.paymentId && o.paymentId !== proof.paymentId)
        )
          fail(409, "DODO_PROOF_MISMATCH");
        if (o.paymentId) return o;
        const ok =
          o.status === "provider_created" &&
          u?.approval === "approved" &&
          u.emailVerified &&
          ["member", "owner"].includes(u.role) &&
          (await eligible(c, o));
        await c.query(
          "UPDATE dodo_test_order SET payment_id=$2,status=$3,test_starts_at=CASE WHEN $4 THEN now() ELSE NULL END,test_ends_at=CASE WHEN $4 THEN now()+interval '7 days' ELSE NULL END WHERE id=$1",
          [id, proof.paymentId, ok ? "verified" : "review", ok],
        );
        return row(c, id);
      });
    },
    async markReview(id: string) {
      return tx(pool, async (c) => {
        await row(c, id);
        await c.query("UPDATE dodo_test_order SET status='review' WHERE id=$1", [id]);
        return row(c, id);
      });
    },
    async findPayment(paymentId: string) {
      return (
        (
          await pool.query<DodoOrder>(
            `SELECT ${columns} FROM dodo_test_order WHERE payment_id=$1`,
            [paymentId],
          )
        ).rows[0] ?? null
      );
    },
    async listPending(limit = 20, afterId?: string) {
      limitCheck(limit);
      if (afterId) uuid(afterId);
      return (
        await pool.query<DodoOrder>(
          `SELECT ${columns} FROM dodo_test_order WHERE status IN ('provider_created','reserved','ambiguous','verified') AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $1`,
          [limit, afterId ?? null],
        )
      ).rows;
    },
    async readInbox(namespace: string, eventId: string) {
      return (
        (
          await pool.query<{
            id: string;
            namespace: string;
            eventId: string;
            raw: string;
            hash: string;
            status: string;
          }>(
            `SELECT id::text,namespace,event_id AS "eventId",raw,hash,status FROM dodo_test_inbox WHERE namespace=$1 AND event_id=$2`,
            [namespace, eventId],
          )
        ).rows[0] ?? null
      );
    },
    async pendingInbox(limit = 20, afterId?: string) {
      limitCheck(limit);
      if (afterId && !/^\d{1,19}$/.test(afterId)) fail(400, "DODO_INVALID_CURSOR");
      return (
        await pool.query<{
          id: string;
          namespace: string;
          eventId: string;
          raw: string;
          hash: string;
        }>(
          `SELECT id::text,namespace,event_id AS "eventId",raw,hash FROM dodo_test_inbox WHERE status='pending' AND ($2::bigint IS NULL OR id>$2::bigint) ORDER BY id LIMIT $1`,
          [limit, afterId ?? null],
        )
      ).rows;
    },
    async finishInbox(id: string, outcome: "processed" | "review") {
      if (!/^\d{1,19}$/.test(id) || !["processed", "review"].includes(outcome))
        fail(400, "DODO_INVALID_INBOX");
      await pool.query("UPDATE dodo_test_inbox SET status=$2 WHERE id=$1 AND status='pending'", [
        id,
        outcome,
      ]);
    },
  };
}
