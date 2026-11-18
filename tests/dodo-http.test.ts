import assert from "node:assert/strict";
import test from "node:test";
import { createDodoTestHttpHandler, type DodoTestHttpService } from "../src/server/dodo/http";
import { createDodoTestService } from "../src/server/dodo/runtime";
import type { createDodoTestAdapter, DodoTestConfig } from "../src/server/dodo/test-adapter";
import type { createDodoTestStore, DodoOrder } from "../src/server/dodo/test-store";

const origin = "https://fixture.invalid",
  id = "00000000-0000-4000-8000-000000000001";
const config: DodoTestConfig = {
  enabled: true,
  environment: "test_mode",
  apiKey: "fixture",
  webhookSecret: "fixture",
  businessId: "biz_fixture",
  productId: "pdt_fixture",
  returnOrigin: origin,
};
function httpFixture() {
  const calls: string[] = [];
  const service: DodoTestHttpService = {
    catalog: () => ({ available: false }),
    create: async () => {
      calls.push("create");
      return {};
    },
    read: async () => ({}),
    reconcile: async () => {
      calls.push("reconcile");
      return {};
    },
    batch: async () => {
      calls.push("batch");
      return {};
    },
    webhook: async () => {
      calls.push("webhook");
      return {};
    },
  };
  return { calls, service, handle: createDodoTestHttpHandler(service, origin) };
}
function request(path: string, body: unknown, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/dodo-test/${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
}
test("Dodo HTTP forbids client amount/support and cross-origin before service", async () => {
  const f = httpFixture();
  for (const body of [
    { requestId: id, businessId: id, amountMinor: 1 },
    { requestId: id, businessId: id, purpose: "support" },
    { requestId: "bad", businessId: id },
  ])
    assert.equal((await f.handle(request("orders", body))).status, 400);
  assert.equal(
    (
      await f.handle(
        request("orders", { requestId: id, businessId: id }, { Origin: "https://evil.invalid" }),
      )
    ).status,
    403,
  );
  assert.deepEqual(f.calls, []);
});
test("Dodo reconcile accepts no redirect payment proof", async () => {
  const f = httpFixture();
  assert.equal(
    (
      await f.handle(
        request(`orders/${id}/reconcile`, { payment_id: "pay_fake", status: "succeeded" }),
      )
    ).status,
    400,
  );
  assert.equal((await f.handle(request(`orders/${id}/reconcile`, {}))).status, 200);
  assert.deepEqual(f.calls, ["reconcile"]);
});
test("Dodo limits mutation body and validates admin cursors", async () => {
  const f = httpFixture();
  assert.equal((await f.handle(request("orders", { x: "a".repeat(2048) }))).status, 413);
  assert.equal((await f.handle(request("admin/reconcile", { inboxAfter: "x" }))).status, 400);
  assert.equal(
    (await f.handle(request("admin/reconcile", { ordersAfter: id, inboxAfter: null }))).status,
    200,
  );
});
function fixture() {
  const calls: string[] = [];
  const row: DodoOrder = {
    id,
    userId: "buyer",
    requestId: id,
    businessId: id,
    categoryId: id,
    merchantId: config.businessId,
    productId: config.productId,
    environment: "test_mode",
    purpose: "promotion",
    amountMinor: 511,
    currency: "EUR",
    status: "provider_created",
    sessionId: "cks_fixture",
    checkoutUrl: "https://test.checkout.dodopayments.com/session/cks_fixture",
    paymentId: null,
    testStartsAt: null,
    testEndsAt: null,
  };
  const store = {
    persistence: {},
    create: async () => {
      calls.push("reserve-order");
      return { ...row, sessionId: null };
    },
    read: async () => {
      calls.push("read-own");
      return row;
    },
    readSystem: async () => row,
    scopedPersistence: () => {
      calls.push("scope");
      return {};
    },
    settleVerified: async () => {
      calls.push("settle-test");
      return { ...row, status: "verified" };
    },
    markReview: async () => {
      calls.push("review");
      return { ...row, status: "review" };
    },
    readInbox: async () => ({
      id: "1",
      namespace: "dodo:test_mode:biz_fixture",
      eventId: "evt_fixture",
      hash: "fixture",
      status: "pending",
      raw: JSON.stringify({ data: { metadata: { ahibizz_order_id: id } } }),
    }),
    finishInbox: async () => {
      calls.push("finish-inbox");
    },
    pendingInbox: async () => [],
    listPending: async () => [],
  } as unknown as ReturnType<typeof createDodoTestStore>;
  const provider = {
    createCheckout: async () => {
      calls.push("provider-create");
      return { sessionId: "cks_fixture", checkoutUrl: row.checkoutUrl };
    },
    reconcileSession: async () => {
      calls.push("provider-read");
      return {
        merchantId: config.businessId,
        productId: config.productId,
        sessionId: "cks_fixture",
        provider: "dodo",
        environment: "test_mode",
        orderId: id,
        paymentId: "pay_fixture",
        amountMinor: 511,
        currency: "EUR",
        status: "succeeded",
      };
    },
    receiveWebhook: async () => {
      calls.push("verify-and-persist");
      return { eventId: "evt_fixture", duplicate: false };
    },
  } as unknown as ReturnType<typeof createDodoTestAdapter>;
  const service = createDodoTestService({
    config: { ...config },
    store,
    provider: () => provider,
    actor: async (_headers, owner) => {
      calls.push(owner ? "owner" : "actor");
      return { userId: "buyer", id: "session", token: "fixture" };
    },
  });
  return { calls, row, store, provider, service };
}
test("Dodo authenticates and reserves before scoped provider create", async () => {
  const f = fixture();
  await f.service.create(new Headers(), { requestId: id, businessId: id });
  assert.deepEqual(f.calls, ["actor", "reserve-order", "scope", "provider-create", "read-own"]);
});
test("Dodo reconcile reads owned order then proof before test-only settlement", async () => {
  const f = fixture();
  await f.service.reconcile(new Headers(), id);
  assert.deepEqual(f.calls, ["actor", "read-own", "provider-read", "settle-test"]);
});
test("Dodo mismatched configured merchant cannot call provider", async () => {
  const f = fixture();
  f.row.merchantId = "other";
  await assert.rejects(f.service.reconcile(new Headers(), id));
  assert.deepEqual(f.calls, ["actor", "read-own"]);
});
test("Dodo webhook persists verified raw before processing and leaves pending consistency retryable", async () => {
  const f = fixture();
  f.provider.reconcileSession = async () => ({ status: "pending" });
  await f.service.webhook(new Headers(), new Uint8Array());
  assert.deepEqual(f.calls, ["verify-and-persist"]);
});
test("Dodo refunds/disputes revoke only test state", async () => {
  const f = fixture();
  f.provider.reconcileSession = async () => ({
    status: "review",
    paymentId: "pay_fixture",
    sessionId: "cks_fixture",
  });
  await f.service.reconcile(new Headers(), id);
  assert.deepEqual(f.calls, ["actor", "read-own", "review"]);
});
test("Dodo admin sweep requires owner and null cursors do not restart finished streams", async () => {
  const f = fixture();
  await f.service.batch(new Headers(), { ordersAfter: null, inboxAfter: null });
  assert.deepEqual(f.calls, ["owner"]);
});

test("Dodo webhook signature/malformed failures are client errors; configuration failures stay503", async () => {
  const f = httpFixture();
  for (const [code, status] of [
    ["DODO_WEBHOOK_SIGNATURE", 401],
    ["DODO_WEBHOOK_INVALID", 400],
    ["DODO_WEBHOOK_IDENTITY", 400],
    ["DODO_WEBHOOK_TOO_LARGE", 413],
    ["DODO_WEBHOOK_SECRET", 503],
  ] as const) {
    f.service.webhook = async () => {
      throw new Error(code);
    };
    assert.equal((await f.handle(request("webhook", {}))).status, status);
  }
});
