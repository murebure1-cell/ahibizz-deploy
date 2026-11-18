import assert from "node:assert/strict";
import test from "node:test";
import {
  type CheckoutHttpService,
  checkoutInput,
  createCheckoutHttpHandler,
} from "../src/server/paypal/http";
import type { createLivePayPal } from "../src/server/paypal/live";
import {
  checkoutCatalog,
  checkoutConfiguration,
  createCheckoutService,
} from "../src/server/paypal/runtime";
import type { createCheckoutStore } from "../src/server/paypal/store";

const origin = "https://checkout.invalid";
const id = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const calls: string[] = [];
  const service: CheckoutHttpService = {
    catalog: () => ({ available: false }),
    reconcileBatch: async () => {
      calls.push("batch");
      return {};
    },
    read: async () => {
      calls.push("read");
      return {};
    },
    create: async () => {
      calls.push("create");
      return {};
    },
    capture: async () => {
      calls.push("capture");
      return {};
    },
    reconcile: async () => {
      calls.push("reconcile");
      return {};
    },
    refund: async () => {
      calls.push("refund");
      return {};
    },
    webhook: async () => {
      calls.push("webhook");
      return {};
    },
  };
  return { calls, service, handle: createCheckoutHttpHandler(service, origin) };
}
function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/checkout/${path}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
test("promotion cannot supply or change its price", () => {
  assert.throws(() =>
    checkoutInput({ requestId: id, kind: "promotion", businessId: id, amountMinor: 1 }),
  );
  assert.deepEqual(checkoutInput({ requestId: id, kind: "promotion", businessId: id }), {
    requestId: id,
    kind: "promotion",
    businessId: id,
  });
});
test("support validates cents and disallows business rights", () => {
  for (const amountMinor of [0, -1, 99, 1.5, 100001, "100"])
    assert.throws(() => checkoutInput({ requestId: id, kind: "support", amountMinor }));
  assert.throws(() =>
    checkoutInput({ requestId: id, kind: "support", amountMinor: 100, businessId: id }),
  );
  assert.equal(checkoutInput({ requestId: id, kind: "support", amountMinor: 100 }).kind, "support");
});
test("origin check happens before a mutation", async () => {
  const f = fixture();
  assert.equal(
    (await f.handle(request("orders", {}, { origin: "https://evil.invalid" }))).status,
    403,
  );
  assert.deepEqual(f.calls, []);
});
test("JSON and bounded payload required", async () => {
  const f = fixture();
  assert.equal(
    (await f.handle(request("orders", {}, { "Content-Type": "text/plain" }))).status,
    415,
  );
  assert.equal((await f.handle(request("orders", { payload: "x".repeat(2100) }))).status, 413);
  assert.deepEqual(f.calls, []);
});
test("capture accepts no client payment proof", async () => {
  const f = fixture();
  assert.equal(
    (await f.handle(request(`orders/${id}/capture`, { paid: true, amountMinor: 511 }))).status,
    400,
  );
  assert.deepEqual(f.calls, []);
  assert.equal((await f.handle(request(`orders/${id}/capture`, {}))).status, 200);
  assert.deepEqual(f.calls, ["capture"]);
});
test("webhook is exempt from browser Origin only, delegates signature verification", async () => {
  const f = fixture();
  assert.equal(
    (await f.handle(request("webhook", { id: "fixture" }, { origin: "https://paypal.invalid" })))
      .status,
    200,
  );
  assert.deepEqual(f.calls, ["webhook"]);
});
test("refund requires UUID, cents and reason", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handle(
        request(`orders/${id}/refund`, { requestId: id, amountMinor: 511, reason: "x" }),
      )
    ).status,
    400,
  );
  assert.deepEqual(f.calls, []);
});
test("paths and query injection cannot reach services", async () => {
  const f = fixture();
  assert.equal(
    (await f.handle(new Request(`${origin}/api/checkout/orders/${id}?actor=other`))).status,
    400,
  );
  assert.deepEqual(f.calls, []);
});
test("configuration is absent by default and all sales gates are required", () => {
  assert.equal(checkoutConfiguration({}), null);
  const vars = {
    PAYPAL_CHECKOUT_ENVIRONMENT: "live",
    PAYPAL_LIVE_CLIENT_ID: "fixture",
    PAYPAL_LIVE_CLIENT_SECRET: "fixture",
    PAYPAL_LIVE_MERCHANT_ID: "fixture",
    PAYPAL_LIVE_WEBHOOK_ID: "fixture",
    PAYPAL_CHECKOUT_PUBLIC_ORIGIN: origin,
    PAYPAL_CHECKOUT_ENABLED: "true",
    PAYPAL_CHECKOUT_EUR_PRICE_APPROVED: "true",
  };
  const config = checkoutConfiguration(vars);
  assert.equal(config?.chargingApproved, false);
  assert.equal(checkoutCatalog(config).available, false);
  assert.equal(
    checkoutConfiguration({ ...vars, PAYPAL_CHECKOUT_FULFILLMENT_READY: "true" })?.chargingApproved,
    true,
  );
});
test("disabled service cannot reach store, auth or provider", async () => {
  let touched = false;
  const config = {
    clientId: "fixture",
    clientSecret: "fixture",
    merchantId: "fixture",
    webhookId: "fixture",
    publicOrigin: origin,
    environment: "live" as const,
    enabled: false,
    priceApproved: false,
    fulfillmentReady: false,
    chargingApproved: false,
  };
  const service = createCheckoutService({
    config,
    store: {} as ReturnType<typeof createCheckoutStore>,
    provider: {} as ReturnType<typeof createLivePayPal>,
    actor: async () => {
      touched = true;
      throw new Error("must not call");
    },
  });
  await assert.rejects(
    service.create(new Headers(), { requestId: id, kind: "promotion", businessId: id }),
  );
  await assert.rejects(service.capture(new Headers(), id));
  assert.equal(touched, false);
});

function serviceFixture(
  options: {
    enabled?: boolean;
    environment?: "live" | "sandbox";
    terminal?: boolean;
    kind?: "promotion" | "support";
  } = {},
) {
  const calls: string[] = [];
  const order = {
    id,
    userId: "buyer",
    requestId: id,
    kind: options.kind ?? "promotion",
    businessId: id,
    businessTitle: "Test",
    amountMinor: 511,
    currency: "EUR",
    merchantId: "merchant",
    environment: options.environment ?? "live",
    providerOrderId: "ORDER12345678",
    captureId: options.terminal ? "CAPTURE123" : null,
    createRequestId: "create-key",
    captureRequestId: "capture-key",
    status: options.terminal ? "captured" : "provider_created",
    refundedMinor: 0,
    startsAt: null,
    endsAt: null,
    version: 1,
  };
  const store = {
    create: async () => {
      calls.push("store-create");
      return order;
    },
    read: async () => {
      calls.push("store-read");
      return order;
    },
    prepareCapture: async () => {
      calls.push("prepare");
      return order;
    },
    settleCapture: async () => {
      calls.push("settle");
      return { ...order, status: "captured" };
    },
    settleRefundedCapture: async () => {
      calls.push("atomic-refund");
      return { ...order, status: "refunded" };
    },
    findByProvider: async () => {
      calls.push("find");
      return order;
    },
  } as unknown as ReturnType<typeof createCheckoutStore>;
  const proof = {
    status: "COMPLETED",
    providerOrderId: "ORDER12345678",
    captureId: "CAPTURE123",
    completedAt: "2026-11-18T18:00:00.000Z",
    amountMinor: 511,
    currency: "EUR",
    merchantId: "merchant",
  };
  const provider = {
    capture: async () => {
      calls.push("capture-provider");
      return proof;
    },
    inspect: async () => ({ ...proof, status: "REFUNDED", refundedMinor: 511 }),
    verifyWebhook: async () => {
      calls.push("verify-signature");
      return true;
    },
  } as unknown as ReturnType<typeof createLivePayPal>;
  const config = {
    clientId: "fixture",
    clientSecret: "fixture",
    merchantId: "merchant",
    webhookId: "fixture",
    publicOrigin: origin,
    environment: "live" as const,
    enabled: options.enabled ?? true,
    priceApproved: true,
    fulfillmentReady: true,
    chargingApproved: options.enabled ?? true,
    refundsApproved: false,
  };
  return {
    calls,
    store,
    provider,
    config,
    service: createCheckoutService({
      store,
      provider,
      config,
      actor: async () => {
        calls.push("authenticate");
        return { userId: "buyer", id: "session", token: "fixture-session" };
      },
    }),
  };
}
test("capture authenticates and durably reserves before provider call", async () => {
  const f = serviceFixture();
  await f.service.capture(new Headers(), id);
  assert.deepEqual(f.calls, ["authenticate", "prepare", "capture-provider", "settle"]);
});
test("terminal order cannot be captured twice", async () => {
  const f = serviceFixture({ terminal: true });
  await f.service.capture(new Headers(), id);
  assert.deepEqual(f.calls, ["authenticate", "prepare"]);
});
test("wrong environment cannot reach live provider", async () => {
  const f = serviceFixture({ environment: "sandbox" });
  await assert.rejects(f.service.capture(new Headers(), id));
  assert.deepEqual(f.calls, ["authenticate", "prepare"]);
});
test("refund-before-capture webhook uses atomic no-grant store transition", async () => {
  const f = serviceFixture();
  await f.service.webhook(new Headers(), {
    id: "event-fixture",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { supplementary_data: { related_ids: { order_id: "ORDER12345678" } } },
  });
  assert.deepEqual(f.calls, ["verify-signature", "find", "atomic-refund"]);
});
test("invalid webhook signature cannot access store", async () => {
  const f = serviceFixture();
  f.provider.verifyWebhook = async () => false;
  await assert.rejects(f.service.webhook(new Headers(), { id: "event-fixture" }));
  assert.deepEqual(f.calls, []);
});
test("refund remains separately gated even when sales enabled", async () => {
  const f = serviceFixture();
  await assert.rejects(
    f.service.refund(new Headers(), id, { requestId: id, amountMinor: 511, reason: "Test" }),
  );
  assert.deepEqual(f.calls, []);
});

test("partial refunds allow a cent while voluntary support retains its minimum", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handle(
        request(`orders/${id}/refund`, { requestId: id, amountMinor: 1, reason: "Partial refund" }),
      )
    ).status,
    200,
  );
  assert.deepEqual(f.calls, ["refund"]);
});

test("reconciliation HTTP validates cursor keys and UUIDs", async () => {
  const f = fixture();
  for (const value of [{ ordersAfter: "invalid" }, { refundsAfter: 42 }, { limit: 1000 }])
    assert.equal((await f.handle(request("admin/reconcile", value))).status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal(
    (await f.handle(request("admin/reconcile", { ordersAfter: id, refundsAfter: null }))).status,
    200,
  );
  assert.deepEqual(f.calls, ["batch"]);
});
test("reconciliation uses bounded environment-scoped cursors and completes streams independently", async () => {
  const f = serviceFixture({ enabled: false });
  const row = await f.store.read({ userId: "buyer", id: "session", token: "fixture" }, id);
  const queried: unknown[] = [];
  f.store.listReconciliation = async (...args) => {
    queried.push(args);
    return Array.from({ length: 20 }, (_, i) => ({
      ...row,
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    }));
  };
  f.store.listPendingRefunds = async (...args) => {
    queried.push(args);
    return [];
  };
  const result = (await f.service.reconcileBatch(new Headers(), {
    ordersAfter: id,
    refundsAfter: null,
  })) as { next: { ordersAfter: string | null; refundsAfter: string | null } };
  assert.deepEqual([...queried], [["live", 20, id]]);
  assert.deepEqual(result.next, {
    ordersAfter: "00000000-0000-4000-8000-000000000020",
    refundsAfter: null,
  });
  f.store.listReconciliation = async (...args) => {
    queried.push(args);
    return [];
  };
  const last = (await f.service.reconcileBatch(new Headers(), result.next)) as {
    next: { ordersAfter: string | null; refundsAfter: string | null };
  };
  assert.deepEqual(last.next, { ordersAfter: null, refundsAfter: null });
  await f.service.reconcileBatch(new Headers(), last.next);
  assert.equal(queried.length, 2);
});

test("HTTP passes original bounded UTF8 webhook JSON alongside parsed event", async () => {
  const f = fixture();
  let observed: string | undefined;
  f.service.webhook = async (_headers, event, raw) => {
    observed = raw;
    assert.deepEqual(event, JSON.parse(raw ?? ""));
    return { received: true };
  };
  const raw = '{\n "id":"event", "n":1.200e2, "text":"\\u0041\\/B"\n}';
  const send = (body: BodyInit) =>
    f.handle(
      new Request(`${origin}/api/checkout/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
  assert.equal((await send(raw)).status, 200);
  assert.equal(observed, raw);
  assert.equal((await send(new Uint8Array([0xff, 0xfe]))).status, 400);
  assert.equal((await send(`{"x":"${"a".repeat(131072)}"}`)).status, 413);
});

test("native refund webhook resolves strict capture up link and records already-refunded event", async () => {
  const f = serviceFixture({ terminal: true });
  const saved = await f.store.read({ userId: "buyer", id: "session", token: "fixture" }, id);
  const lookups: unknown[] = [];
  const events: (string | undefined)[] = [];
  f.store.findByProvider = async (...args) => {
    lookups.push(args);
    return { ...saved, status: "refunded" };
  };
  f.store.settleRefundedCapture = async (_id, _proof, _refund, eventId) => {
    events.push(eventId);
    return { ...saved, status: "refunded" };
  };
  await f.service.webhook(new Headers(), {
    id: "native-refund-event",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: "REFUND1234567",
      links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAPTURE1234567" }],
    },
  });
  assert.deepEqual(lookups, [["live", { captureId: "CAPTURE1234567" }]]);
  assert.deepEqual(events, ["native-refund-event"]);
});
test("refund webhook ignores malicious, cross-environment or malformed capture links", async () => {
  const f = serviceFixture();
  const base = "https://api.paypal.com/v2/payments/captures/CAPTURE1234567";
  for (const href of [
    base.replace("api.paypal.com", "evil.invalid"),
    base.replace("api.paypal.com", "api.sandbox.paypal.com"),
    base.replace("https:", "http:"),
    `${base}?x=1`,
    `${base}#x`,
    base.replace("api.paypal.com", "user@api.paypal.com"),
    base.replace("api.paypal.com", "api.paypal.com:443"),
    `${base}/`,
    base.replace("CAPTURE1234567", "bad"),
    base.replace("api.paypal.com", "api.paypal.com.evil.invalid"),
  ]) {
    const result = await f.service.webhook(new Headers(), {
      id: "event",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { links: [{ rel: "up", href }] },
    });
    assert.deepEqual(result, { received: true, matched: false });
  }
  assert.ok(f.calls.every((call) => call === "verify-signature"));
});

test("live support create is rejected before authentication store or provider", async () => {
  const f = serviceFixture();
  await assert.rejects(
    f.service.create(new Headers(), { requestId: id, kind: "support", amountMinor: 100 }),
    /LIVE_SUPPORT_NOT_RELEASED/,
  );
  assert.deepEqual(f.calls, []);
  assert.equal(checkoutCatalog(f.config).support.available, false);
});
test("existing live support cannot capture or use busy-order reconciliation fallback", async () => {
  const f = serviceFixture({ kind: "support" });
  await assert.rejects(f.service.capture(new Headers(), id), /LIVE_SUPPORT_NOT_RELEASED/);
  assert.deepEqual(f.calls, ["authenticate", "prepare"]);
  f.calls.length = 0;
  f.store.prepareCapture = async () => {
    throw Object.assign(new Error("busy"), { code: "ORDER_BUSY_OR_EXPIRED" });
  };
  await assert.rejects(f.service.capture(new Headers(), id), /LIVE_SUPPORT_NOT_RELEASED/);
  assert.deepEqual(f.calls, ["authenticate", "store-read"]);
});
test("webhook verification and reconciliation remain available with new sales disabled", async () => {
  const f = serviceFixture({ enabled: false });
  await f.service.webhook(new Headers(), {
    id: "event-disabled",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: { supplementary_data: { related_ids: { order_id: "ORDER12345678" } } },
  });
  assert.deepEqual(f.calls, ["verify-signature", "find", "atomic-refund"]);
});
