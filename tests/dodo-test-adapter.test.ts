import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createDodoTestAdapter,
  type DodoTestConfig,
  type DodoTestOrder,
  type DodoTestPersistence,
  type DodoTestSession,
  dodoTestConfiguration,
} from "../src/server/dodo/test-adapter";

const config: DodoTestConfig = {
  enabled: true,
  environment: "test_mode",
  apiKey: "fixture",
  webhookSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
  productId: "pdt_fixture",
  businessId: "biz_fixture",
  returnOrigin: "https://fixture.invalid",
};
const order: DodoTestOrder = {
  id: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
  purpose: "promotion",
  amountMinor: 511,
  currency: "EUR",
};
function fixture() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const product = {
    product_id: config.productId,
    business_id: config.businessId,
    is_recurring: false,
    price: { type: "one_time_price", price: 511, currency: "EUR", tax_inclusive: true },
  };
  const payment = {
    payment_id: "pay_fixture",
    business_id: config.businessId,
    status: "succeeded",
    currency: "EUR",
    total_amount: 511,
    metadata: {
      ahibizz_order_id: order.id,
      ahibizz_request_id: order.requestId,
      purpose: "promotion",
      environment: "test_mode",
    },
    product_cart: [{ product_id: config.productId, quantity: 1 }],
    subscription_ids: [],
    refunds: [],
    disputes: [],
  };
  // Test double ONLY, not a production persistence implementation.
  const commands = new Map<string, { fingerprint: string; result?: DodoTestSession }>(),
    events = new Map<string, string>();
  const persistence: DodoTestPersistence = {
    async createOnce(_namespace, key, fingerprint, send) {
      const existing = commands.get(key);
      if (existing) {
        assert.equal(existing.fingerprint, fingerprint);
        if (!existing.result) throw Error("AMBIGUOUS");
        return existing.result;
      }
      const row = { fingerprint, result: undefined as DodoTestSession | undefined };
      commands.set(key, row);
      row.result = await send();
      return row.result;
    },
    async putVerifiedEvent(_ns, id, _raw, hash) {
      if (events.has(id)) {
        assert.equal(events.get(id), hash);
        return false;
      }
      events.set(id, hash);
      return true;
    },
  };
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(
      String(url).includes("/products/")
        ? product
        : String(url).includes("/payments/")
          ? payment
          : {
              session_id: "cks_fixture",
              checkout_url: "https://test.checkout.dodopayments.com/session/cks_fixture",
            },
    );
  }) as typeof fetch;
  return {
    calls,
    product,
    payment,
    persistence,
    transport,
    client: createDodoTestAdapter(config, persistence, transport, () => 1700000000000),
  };
}
test("Dodo default disabled, live impossible and support prohibited", async () => {
  assert.equal(dodoTestConfiguration({}), null);
  const f = fixture();
  for (const cfg of [
    { ...config, enabled: false },
    { ...config, environment: "live_mode" as "test_mode" },
  ])
    await assert.rejects(
      createDodoTestAdapter(cfg, f.persistence, f.transport).createCheckout(order),
    );
  await assert.rejects(f.client.createCheckout({ ...order, purpose: "support" as "promotion" }));
  assert.equal(f.calls.length, 0);
});
test("Dodo verifies fixed inclusive product before one durable create; no invented header or override", async () => {
  const f = fixture();
  await f.client.createCheckout(order);
  await f.client.createCheckout(order);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((c) => c.url.startsWith("https://test.dodopayments.com/")));
  const request = f.calls[1]?.init;
  assert.equal(request?.redirect, "error");
  const body = JSON.parse(String(request?.body));
  assert.deepEqual(body.product_cart, [{ product_id: config.productId, quantity: 1 }]);
  assert.equal(new Headers(request?.headers).has("Idempotency-Key"), false);
});
test("Dodo rejects price mismatch and ambiguous create is never retried", async () => {
  const f = fixture();
  f.product.price.price = 512;
  await assert.rejects(f.client.createCheckout(order), /PRICE_MISMATCH/);
  f.product.price.price = 511;
  await assert.rejects(f.client.createCheckout(order), /AMBIGUOUS/);
  assert.equal(f.calls.length, 1);
});
test("Dodo server read verifies payment product identity total status and metadata", async () => {
  const f = fixture();
  assert.equal((await f.client.verifyPayment(order, "pay_fixture")).environment, "test_mode");
  for (const field of ["status", "currency", "business_id"] as const) {
    const original = f.payment[field];
    f.payment[field] = "wrong";
    await assert.rejects(f.client.verifyPayment(order, "pay_fixture"));
    f.payment[field] = original;
  }
  f.payment.total_amount = 512;
  await assert.rejects(f.client.verifyPayment(order, "pay_fixture"));
  f.payment.total_amount = 511;
  f.payment.metadata.ahibizz_order_id = "other";
  await assert.rejects(f.client.verifyPayment(order, "pay_fixture"));
});
function signed(raw: Uint8Array, timestamp = "1700000000") {
  return new Headers({
    "webhook-id": "evt_fixture",
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${createHmac("sha256", Buffer.alloc(32, 7)).update(`evt_fixture.${timestamp}.`).update(raw).digest("base64")}`,
  });
}
test("Dodo exact raw HMAC and durable event dedup", async () => {
  const f = fixture(),
    raw = Buffer.from('{ "business_id":"biz_fixture", "type":"payment.succeeded", "n":1.00e2 }');
  assert.equal((await f.client.receiveWebhook(signed(raw), raw)).duplicate, false);
  assert.equal((await f.client.receiveWebhook(signed(raw), raw)).duplicate, true);
  await assert.rejects(
    f.client.receiveWebhook(signed(raw), Buffer.from(JSON.stringify(JSON.parse(raw.toString())))),
    /SIGNATURE/,
  );
});
test("Dodo stale/future, invalid signature and wrong merchant fail before inbox", async () => {
  const f = fixture(),
    raw = Buffer.from('{"business_id":"other","type":"payment.succeeded"}');
  await assert.rejects(f.client.receiveWebhook(signed(raw, "1699999000"), raw));
  await assert.rejects(f.client.receiveWebhook(signed(raw, "1700001000"), raw));
  await assert.rejects(f.client.receiveWebhook(signed(raw), raw), /IDENTITY/);
});

test("Dodo session reconciliation derives payment from saved session rather than redirect", async () => {
  const f = fixture();
  const transport = (async (url: string | URL | Request) =>
    Response.json(
      String(url).includes("/checkouts/")
        ? { id: "cks_fixture", payment_id: "pay_fixture" }
        : f.payment,
    )) as typeof fetch;
  const client = createDodoTestAdapter(config, f.persistence, transport);
  const result = await client.reconcileSession(order, "cks_fixture");
  assert.equal(result.status, "succeeded");
  assert.equal("sessionId" in result ? result.sessionId : null, "cks_fixture");
  f.payment.refunds.push({} as never);
  assert.equal((await client.reconcileSession(order, "cks_fixture")).status, "review");
});
test("Dodo forged session identity fails before any payment proof", async () => {
  const f = fixture();
  const transport = (async () =>
    Response.json({ id: "cks_other", payment_id: "pay_fixture" })) as typeof fetch;
  await assert.rejects(
    createDodoTestAdapter(config, f.persistence, transport).reconcileSession(order, "cks_fixture"),
    /SESSION_MISMATCH/,
  );
});
