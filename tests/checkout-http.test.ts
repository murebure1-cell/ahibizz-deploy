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
    resumeCard: async () => {
      calls.push("card-session");
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
test("guest card session accepts only a same-origin empty POST for the existing order", async () => {
  const f = fixture();
  const path = `orders/${id}/card-session`;
  assert.equal((await f.handle(new Request(`${origin}/api/checkout/${path}`))).status, 404);
  assert.equal(
    (await f.handle(request(path, {}, { origin: "https://other.invalid" }))).status,
    403,
  );
  assert.equal((await f.handle(request(path, { providerOrderId: "PAYMENT123456" }))).status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.handle(request(path, {}))).status, 200);
  assert.deepEqual(f.calls, ["card-session"]);
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
    offerVersion: "category-seven-days-20261118",
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
test("failed refund webhook re-reads the known refund and confirms the original capture", async () => {
  const f = serviceFixture({ terminal: true });
  const saved = {
    ...(await f.store.read({ userId: "buyer", id: "session", token: "f" }, id)),
    status: "review",
  };
  f.calls.length = 0;
  const refundId = "REFUND1234567";
  const refund = { refundId, captureId: "CAPTURE123", amountMinor: 100, status: "FAILED" as const };
  f.store.findRefundByProvider = async (environment, providerId) => {
    f.calls.push("match-refund");
    assert.equal(environment, saved.environment);
    assert.equal(providerId, refundId);
    return { id, orderId: id, amountMinor: refund.amountMinor };
  };
  f.store.readSystem = async () => saved;
  f.provider.readRefund = async (_order, input) => {
    f.calls.push("inspect-refund");
    const { status: _status, ...identity } = refund;
    assert.deepEqual(input, identity);
    return refund;
  };
  f.store.attachRefundResult = async (commandId, result) => {
    f.calls.push("record-refund");
    assert.equal(commandId, id);
    assert.deepEqual(result, refund);
    return saved;
  };
  assert.ok(saved.providerOrderId);
  const proof = {
    status: "COMPLETED" as const,
    providerOrderId: saved.providerOrderId,
    captureId: refund.captureId,
    merchantId: saved.merchantId,
    amountMinor: saved.amountMinor,
    currency: "EUR" as const,
    completedAt: "2026-11-18T18:00:00.000Z",
  };
  f.provider.inspect = async () => {
    f.calls.push("confirm-capture");
    return proof;
  };
  f.store.settleCapture = async (_id, facts, webhookId) => {
    f.calls.push("settle");
    assert.equal(facts.captureId, proof.captureId);
    assert.equal(webhookId, "failed-refund-event");
    return { ...saved, status: "captured" };
  };
  assert.deepEqual(
    await f.service.webhook(new Headers(), {
      id: "failed-refund-event",
      event_type: "PAYMENT.REFUND.FAILED",
      resource: { id: refundId },
    }),
    { received: true, matched: true },
  );
  assert.deepEqual(f.calls, [
    "verify-signature",
    "match-refund",
    "inspect-refund",
    "record-refund",
    "confirm-capture",
    "settle",
  ]);
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

test("promotion accepts SDK and guest flows without a client price; guest is unavailable for support", () => {
  assert.equal(
    checkoutInput({ requestId: id, kind: "promotion", businessId: id, flow: "sdk" }).flow,
    "sdk",
  );
  for (const flow of ["redirect", "card", "live", true, null])
    assert.throws(() => checkoutInput({ requestId: id, kind: "promotion", businessId: id, flow }));
  assert.equal(
    checkoutInput({ requestId: id, kind: "promotion", businessId: id, flow: "guest" }).flow,
    "guest",
  );
  assert.throws(() =>
    checkoutInput({ requestId: id, kind: "support", amountMinor: 511, flow: "guest" }),
  );
  assert.equal(
    checkoutInput({ requestId: id, kind: "promotion", businessId: id, flow: "card-fields" }).flow,
    "card-fields",
  );
  assert.throws(() =>
    checkoutInput({ requestId: id, kind: "support", amountMinor: 511, flow: "card-fields" }),
  );
  assert.throws(() =>
    checkoutInput({
      requestId: id,
      kind: "promotion",
      businessId: id,
      amountMinor: 1,
      flow: "guest",
    }),
  );
  assert.throws(() =>
    checkoutInput({
      requestId: id,
      kind: "promotion",
      businessId: id,
      flow: "sdk",
      amountMinor: 1,
    }),
  );
});
test("SDK catalog exposes only public client ID when released", () => {
  const f = serviceFixture();
  const catalog = checkoutCatalog({
    ...f.config,
    clientId: "public-client",
    clientSecret: "private-secret",
  });
  assert.equal(catalog.paypalClientId, "public-client");
  assert.equal(JSON.stringify(catalog).includes("private-secret"), false);
  assert.equal(checkoutCatalog({ ...f.config, chargingApproved: false }).paypalClientId, null);
});
for (const method of ["sdk", "guest", "card-fields"] as const) {
  test(`${method} persists mode before create and reads and resumes the same provider order`, async () => {
    const f = serviceFixture();
    const row = await f.store.read({ userId: "buyer", id: "session", token: "fixture" }, id);
    let saved = {
      ...row,
      providerOrderId: null as string | null,
      offerVersion: `category-seven-days-20261118:${method}`,
      approvalUrl: null as string | null,
      status: "created",
    };
    let calls = 0;
    const approvalUrl =
      method === "guest" ? "https://www.paypal.com/checkoutnow?token=PAYMENT123456" : null;
    f.store.create = async (_actor, input) => {
      assert.equal(input.offerVersion, `category-seven-days-20261118:${method}`);
      assert.equal(input.amountMinor, 511);
      return saved;
    };
    f.store.read = async () => saved;
    f.provider.create = async (_order, flow) => {
      calls++;
      assert.equal(flow, method);
      return { providerOrderId: "PAYMENT123456", approvalUrl };
    };
    f.store.attachProvider = async (_id, value) => {
      saved = { ...saved, ...value, status: "provider_created" };
      return saved;
    };
    const input = { requestId: id, kind: "promotion" as const, businessId: id, flow: method };
    const first = (await f.service.create(new Headers(), input)) as {
      providerOrderId: string;
      approvalUrl: string | null;
      order: { flow: string };
    };
    const again = (await f.service.create(new Headers(), input)) as { providerOrderId: string };
    assert.equal(first.providerOrderId, "PAYMENT123456");
    assert.equal(first.order.flow, method);
    assert.equal(first.approvalUrl, approvalUrl);
    assert.deepEqual(await f.service.read(new Headers(), id), first.order);
    assert.equal(again.providerOrderId, first.providerOrderId);
    assert.equal(calls, 1);
  });
}
test("inline recovery exposes only an eligible saved provider ID and rechecks ownership after provider IO", async () => {
  const f = serviceFixture();
  const raw = await f.store.read({ userId: "buyer", id: "session", token: "fixture" }, id);
  const saved = { ...raw, offerVersion: "category-seven-days-20261118:guest" };
  let reads = 0,
    authorized = true,
    payable = true;
  f.store.readPendingGuestCard = async (actor, orderId) => {
    assert.equal(orderId, id);
    assert.equal(actor.userId, "buyer");
    reads++;
    if (!authorized) throw new Error("BUSINESS_CHANGED");
    return saved;
  };
  f.provider.canResumeCard = async (expected) => {
    assert.equal(expected.id, id);
    assert.equal(expected.providerOrderId, saved.providerOrderId);
    return payable;
  };
  const result = (await f.service.resumeCard(new Headers(), id)) as {
    order: { id: string; flow: string };
    providerOrderId: string;
  };
  assert.equal(result.order.id, id);
  assert.equal(result.order.flow, "guest");
  assert.equal(result.providerOrderId, saved.providerOrderId);
  assert.deepEqual(Object.keys(result).sort(), ["order", "providerOrderId"]);
  assert.equal(reads, 2);
  payable = false;
  await assert.rejects(f.service.resumeCard(new Headers(), id), /ORDER_NOT_PAYABLE/);
  f.provider.canResumeCard = async () => {
    authorized = false;
    return true;
  };
  await assert.rejects(f.service.resumeCard(new Headers(), id), /BUSINESS_CHANGED/);
});
