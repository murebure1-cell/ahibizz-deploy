import assert from "node:assert/strict";
import test from "node:test";
import {
  createLivePayPal,
  type LiveOrder,
  liveAmount,
  liveApprovalUrl,
  verifyLiveOrder,
} from "../src/server/paypal/live";

const order: LiveOrder = {
  id: "00000000-0000-4000-8000-000000000001",
  purpose: "promotion",
  amountMinor: 511,
  currency: "EUR",
  merchantId: "FIXTURE_MERCHANT",
  providerOrderId: "ORDER12345678",
  createRequestId: "create-fixture",
  captureRequestId: "capture-fixture",
};
const config = {
  clientId: "fixture",
  clientSecret: "fixture",
  merchantId: "FIXTURE_MERCHANT",
  webhookId: "fixture-hook",
  publicOrigin: "https://ahibizz.invalid",
  chargingApproved: false,
};
function provider() {
  return {
    id: order.providerOrderId,
    intent: "CAPTURE",
    status: "COMPLETED",
    purchase_units: [
      {
        custom_id: order.id,
        payee: { merchant_id: order.merchantId },
        amount: { value: "5.11", currency_code: "EUR" },
        payments: {
          captures: [
            {
              id: "CAPTURE_FIXTURE",
              status: "COMPLETED",
              final_capture: true,
              create_time: "2026-11-18T15:00:00Z",
              amount: { value: "5.11", currency_code: "EUR" },
            },
          ],
        },
      },
    ],
  };
}
test("unreleased live adapter cannot create or capture even with credentials", async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    throw new Error("Network forbidden in test");
  }) as typeof fetch;
  const client = createLivePayPal(config, transport);
  await assert.rejects(client.create(order), /LIVE_CHECKOUT_NOT_RELEASED/);
  await assert.rejects(client.capture(order), /LIVE_CHECKOUT_NOT_RELEASED/);
  assert.equal(calls, 0);
});
test("guest card resume reads and validates the saved PayPal order without creating or capturing", async () => {
  const detail = provider();
  const route = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "fixture" });
    assert.equal(
      String(url),
      `https://api-m.paypal.com/v2/checkout/orders/${order.providerOrderId}`,
    );
    assert.equal(init?.method, "GET");
    return Response.json(detail);
  };
  const client = createLivePayPal(config, route);
  detail.status = "PAYER_ACTION_REQUIRED";
  assert.equal(await client.canResumeCard(order), false);
  const unit = detail.purchase_units[0];
  assert.ok(unit);
  unit.payments.captures.length = 0;
  assert.equal(await client.canResumeCard(order), true);
  Reflect.deleteProperty(unit, "payments");
  detail.status = "CREATED";
  assert.equal(await client.canResumeCard(order), true);
  Object.assign(unit, { payments: null });
  await assert.rejects(client.canResumeCard(order), /INVALID_PROVIDER_RESPONSE/);
  Reflect.deleteProperty(unit, "payments");
  for (const status of ["APPROVED", "VOIDED", "COMPLETED"]) {
    detail.status = status;
    assert.equal(await client.canResumeCard(order), false);
  }
  detail.status = "PAYER_ACTION_REQUIRED";
  unit.amount.value = "5.12";
  await assert.rejects(client.canResumeCard(order), /ORDER_MISMATCH/);
});
test("cancellation requires a matched CREATED or VOIDED order with no captures or authorizations", async () => {
  const detail = provider();
  const unit = detail.purchase_units[0];
  assert.ok(unit);
  const client = createLivePayPal(config, async (url, init) => {
    if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "fixture" });
    assert.equal(
      String(url),
      `https://api-m.paypal.com/v2/checkout/orders/${order.providerOrderId}`,
    );
    assert.equal(init?.method, "GET");
    return Response.json(detail);
  });
  detail.status = "CREATED";
  assert.equal(await client.isUnpaidForCancellation(order), false);
  Object.assign(unit, { payments: { authorizations: [{ id: "AUTHORIZATION" }] } });
  assert.equal(await client.isUnpaidForCancellation(order), false);
  Object.assign(unit, { payments: { captures: [], authorizations: [] } });
  assert.equal(await client.isUnpaidForCancellation(order), true);
  Object.assign(unit, { payments: { authorizations: null } });
  assert.equal(await client.isUnpaidForCancellation(order), false);
  Reflect.deleteProperty(unit, "payments");
  assert.equal(await client.isUnpaidForCancellation(order), true);
  for (const status of ["APPROVED", "SAVED", "PAYER_ACTION_REQUIRED", "COMPLETED", ""]) {
    detail.status = status;
    assert.equal(await client.isUnpaidForCancellation(order), false);
  }
  detail.status = "VOIDED";
  assert.equal(await client.isUnpaidForCancellation(order), true);
  Object.assign(unit, { payments: { authorizations: [{ id: "AUTHORIZATION" }] } });
  assert.equal(await client.isUnpaidForCancellation(order), false);
  detail.status = "CREATED";
  unit.amount.value = "5.12";
  await assert.rejects(client.isUnpaidForCancellation(order), /ORDER_MISMATCH/);
});
test("live endpoint cannot accept sandbox redirects or non-HTTPS callbacks", () => {
  assert.equal(
    liveApprovalUrl("https://www.paypal.com/checkoutnow?token=fixture"),
    "https://www.paypal.com/checkoutnow?token=fixture",
  );
  for (const url of [
    "https://www.sandbox.paypal.com/checkoutnow",
    "https://www.paypal.com.evil.invalid/checkoutnow",
    "https://www.paypal.com/signin",
    "http://www.paypal.com/checkoutnow",
  ])
    assert.throws(() => liveApprovalUrl(url));
  assert.throws(() => createLivePayPal({ ...config, publicOrigin: "http://127.0.0.1:3012" }));
});
test("minor units format exactly and reject unsafe amounts", () => {
  assert.equal(liveAmount(511), "5.11");
  assert.equal(liveAmount(100), "1.00");
  for (const n of [0, -1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => liveAmount(n));
});
test("live capture validates identity, purpose binding, recipient, amount and completion", () => {
  assert.equal(verifyLiveOrder(provider(), order).captureId, "CAPTURE_FIXTURE");
  assert.throws(() => verifyLiveOrder(provider(), { ...order, id: "different" }));
  assert.throws(() => verifyLiveOrder(provider(), { ...order, merchantId: "wrong" }));
  assert.throws(() => verifyLiveOrder(provider(), { ...order, amountMinor: 1000 }));
  assert.throws(() => verifyLiveOrder(provider(), { ...order, providerOrderId: "other" }));
  const pending = provider();
  pending.status = "APPROVED";
  assert.throws(() => verifyLiveOrder(pending, order));
  assert.throws(() => verifyLiveOrder(pending, order, false), /PAYPAL_CAPTURE_PENDING/);
  Reflect.deleteProperty(pending.purchase_units[0] ?? {}, "payments");
  assert.equal(verifyLiveOrder(pending, order, false).status, "APPROVED");
});
test("provider inspection distinguishes approval, missing 3DS and voided guest orders without charging", async () => {
  const detail = provider();
  const unit = detail.purchase_units[0];
  assert.ok(unit);
  Reflect.deleteProperty(unit, "payments");
  const client = createLivePayPal(config, async (url, init) => {
    if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "fixture" });
    assert.equal(init?.method, "GET");
    return Response.json(detail);
  });
  for (const [state, normalized] of [
    ["APPROVED", "APPROVED"],
    ["PAYER_ACTION_REQUIRED", "ACTION_REQUIRED"],
    ["VOIDED", "VOIDED"],
    ["CREATED", "UNPAID"],
    ["SAVED", "UNPAID"],
    ["UNEXPECTED", "UNKNOWN"],
  ]) {
    detail.status = state ?? "";
    assert.deepEqual(await client.inspect(order), { status: normalized });
  }
  detail.status = "APPROVED";
  Object.assign(unit, { payments: { captures: [], authorizations: [{ id: "AUTHORIZATION" }] } });
  assert.deepEqual(await client.inspect(order), { status: "PENDING" });
});
test("guest capture reads approval and emits only whitelisted PayPal rejection codes", async () => {
  const detail = provider();
  Reflect.deleteProperty(detail.purchase_units[0] ?? {}, "payments");
  let captureRequests = 0;
  let issue = "";
  const client = createLivePayPal({ ...config, chargingApproved: true }, async (url, init) => {
    if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "fixture" });
    if (init?.method === "GET") return Response.json(detail);
    assert.equal(init?.method, "POST");
    assert.ok(String(url).endsWith("/capture"));
    assert.equal(new Headers(init.headers).get("PayPal-Request-Id"), order.captureRequestId);
    captureRequests++;
    return Response.json(
      { details: [{ issue, description: "private provider detail" }] },
      { status: 422 },
    );
  });
  detail.status = "PAYER_ACTION_REQUIRED";
  await assert.rejects(client.capture(order, "guest"), /PAYPAL_PAYER_ACTION_REQUIRED/);
  assert.equal(captureRequests, 0);
  detail.status = "APPROVED";
  issue = "INSTRUMENT_DECLINED";
  await assert.rejects(client.capture(order, "guest"), /PAYPAL_CARD_DECLINED/);
  issue = "UNEXPECTED_PRIVATE_ERROR";
  await assert.rejects(client.capture(order, "guest"), /PAYPAL_REQUEST_FAILED/);
  assert.equal(captureRequests, 2);
});
test("a declined or failed capture is not reported as an actual refund", async () => {
  const detail = provider();
  const capture = detail.purchase_units[0]?.payments.captures[0];
  assert.ok(capture);
  capture.id = "CAPTURE12345678";
  const client = createLivePayPal(config, async (url, init) => {
    if (String(url).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "fixture" });
    assert.equal(init?.method, "GET");
    return Response.json(
      String(url).endsWith(`/v2/payments/captures/${capture.id}`)
        ? {
            ...capture,
            payee: { merchant_id: order.merchantId },
            supplementary_data: { related_ids: { order_id: order.providerOrderId } },
          }
        : detail,
    );
  });
  for (const status of ["DECLINED", "FAILED", "REFUNDED"]) {
    capture.status = status;
    const result = await client.inspect(order);
    assert.equal(result.status, status === "REFUNDED" ? "REFUNDED" : "REVERSED");
    assert.ok("refundedMinor" in result);
    assert.equal(result.refundedMinor, status === "REFUNDED" ? 511 : 0);
  }
});
test("completed live order is re-read without a second capture", async () => {
  const calls: string[] = [];
  const transport = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json(String(url).endsWith("/token") ? { access_token: "fixture" } : provider());
  }) as typeof fetch;
  const result = await createLivePayPal({ ...config, chargingApproved: true }, transport).capture(
    order,
  );
  assert.equal(result.captureId, "CAPTURE_FIXTURE");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith("https://api-m.paypal.com/")));
  assert.ok(calls.every((url) => !url.endsWith("/capture")));
});
test("webhook rejects untrusted certificate hosts without a network request", async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    throw new Error("Network forbidden");
  }) as typeof fetch;
  const value = await createLivePayPal(config, transport).verifyWebhook(
    new Headers({ "paypal-cert-url": "https://evil.invalid/cert" }),
    {},
  );
  assert.equal(value, false);
  assert.equal(calls, 0);
});

test("refund is release-gated and never over-refunds the order", async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    throw new Error("No network");
  }) as typeof fetch;
  await assert.rejects(
    createLivePayPal(config, transport).refund(order, {
      captureId: "CAPTURE1234567",
      amountMinor: 511,
      requestId: "refund-command",
    }),
    /NOT_RELEASED/,
  );
  await assert.rejects(
    createLivePayPal(
      { ...config, chargingApproved: true, refundsApproved: true },
      transport,
    ).refund(order, {
      captureId: "CAPTURE1234567",
      amountMinor: 512,
      requestId: "refund-command",
    }),
    /INVALID_REFUND/,
  );
  assert.equal(calls, 0);
});
test("sandbox transport can use loopback callbacks but never a live approval URL", async () => {
  const calls: string[] = [];
  const transport = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json(
      String(url).endsWith("/token")
        ? { access_token: "fixture" }
        : {
            id: "ORDER12345678",
            links: [
              { rel: "payer-action", href: "https://www.paypal.com/checkoutnow?token=fixture" },
            ],
          },
    );
  }) as typeof fetch;
  const client = createLivePayPal(
    {
      ...config,
      chargingApproved: true,
      environment: "sandbox",
      publicOrigin: "http://127.0.0.1:3012",
    },
    transport,
  );
  await assert.rejects(client.create(order), /INVALID_APPROVAL_URL/);
  assert.ok(calls.every((url) => url.startsWith("https://api-m.sandbox.paypal.com/")));
});
test("refund detail verifies capture binding and amount", async () => {
  const transport = (async (url: string | URL | Request) =>
    Response.json(
      String(url).endsWith("/token")
        ? { access_token: "fixture" }
        : {
            id: "REFUND1234567",
            status: "COMPLETED",
            amount: { value: "1.00", currency_code: "EUR" },
            links: [
              { rel: "up", href: "https://api-m.paypal.com/v2/payments/captures/CAPTURE1234567" },
            ],
          },
    )) as typeof fetch;
  const client = createLivePayPal(config, transport);
  assert.equal(
    (
      await client.readRefund(order, {
        refundId: "REFUND1234567",
        captureId: "CAPTURE1234567",
        amountMinor: 100,
      })
    ).status,
    "COMPLETED",
  );
  await assert.rejects(
    client.readRefund(order, {
      refundId: "REFUND1234567",
      captureId: "OTHER12345678",
      amountMinor: 100,
    }),
    /REFUND_MISMATCH/,
  );
  await assert.rejects(
    client.readRefund(order, {
      refundId: "REFUND1234567",
      captureId: "CAPTURE1234567",
      amountMinor: 200,
    }),
    /REFUND_MISMATCH/,
  );
});
test("signature endpoint success is required; presence of PayPal headers is insufficient", async () => {
  let verified = false;
  const transport = (async (url: string | URL | Request) =>
    Response.json(
      String(url).endsWith("/token")
        ? { access_token: "fixture" }
        : { verification_status: verified ? "SUCCESS" : "FAILURE" },
    )) as typeof fetch;
  const headers = new Headers({
    "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/FIXTURE",
    "paypal-transmission-id": "fixture",
    "paypal-transmission-sig": "fixture",
    "paypal-transmission-time": "2026-11-18T15:00:00Z",
    "paypal-auth-algo": "SHA256withRSA",
  });
  const client = createLivePayPal(config, transport);
  assert.equal(await client.verifyWebhook(headers, { id: "event" }, '{"id":"event"}'), false);
  verified = true;
  assert.equal(await client.verifyWebhook(headers, { id: "event" }, '{"id":"event"}'), true);
});

test("webhook verification preserves raw whitespace, escaping and numeric representation", async () => {
  const raw = '{ \n "id" : "event", "escaped":"\\u0041\\/B", "n":1.2300e+2 }\n';
  const event = JSON.parse(raw);
  let sent = "";
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "fixture" });
    sent = String(init?.body);
    return Response.json({ verification_status: "SUCCESS" });
  }) as typeof fetch;
  const client = createLivePayPal(config, transport);
  const headers = new Headers({
    "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/FIXTURE",
  });
  assert.equal(await client.verifyWebhook(headers, event, raw), true);
  assert.ok(sent.endsWith(`,"webhook_event":${raw}}`));
  assert.deepEqual(JSON.parse(sent).webhook_event, event);
  sent = "";
  assert.equal(await client.verifyWebhook(headers, { id: "different" }, raw), false);
  assert.equal(await client.verifyWebhook(headers, event), false);
  assert.equal(sent, "");
});

test("SDK creates neutral order without wallet source and accepts no approval link", async () => {
  let body: Record<string, unknown> | null = null;
  let key: string | null = null;
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "fixture" });
    body = JSON.parse(String(init?.body));
    key = new Headers(init?.headers).get("PayPal-Request-Id");
    return Response.json({
      ...provider(),
      status: "CREATED",
      links: [
        { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER12345678" },
      ],
    });
  }) as typeof fetch;
  const client = createLivePayPal(
    { ...config, chargingApproved: true, environment: "sandbox" },
    transport,
  );
  const result = await client.create(order, "sdk");
  assert.equal(result.providerOrderId, order.providerOrderId);
  assert.equal(result.approvalUrl, null);
  assert.ok(body);
  assert.equal(Object.hasOwn(body, "payment_source"), false);
  assert.equal(key, order.createRequestId);
  assert.deepEqual((body as Record<string, unknown>).application_context, {
    shipping_preference: "NO_SHIPPING",
    user_action: "PAY_NOW",
  });
});
test("SDK rejects completed, wrong recipient, amount and unsafe approval links", async () => {
  const base = { ...provider(), status: "CREATED", links: [] as unknown[] };
  const wrong = structuredClone(base);
  const wrongUnit = wrong.purchase_units[0];
  assert.ok(wrongUnit);
  wrongUnit.amount.value = "0.01";
  for (const data of [
    { ...base, status: "COMPLETED" },
    wrong,
    { ...base, links: [{ rel: "approve", href: "https://evil.invalid" }] },
  ]) {
    const transport = (async (url: string | URL | Request) =>
      Response.json(
        String(url).endsWith("/token") ? { access_token: "fixture" } : data,
      )) as typeof fetch;
    await assert.rejects(
      createLivePayPal(
        { ...config, chargingApproved: true, environment: "sandbox" },
        transport,
      ).create(order, "sdk"),
    );
  }
});

test("integrated card fields request SCA when required and keep issuer links inside the SDK", async () => {
  const mock = (async (url, init) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "fixture" });
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.payment_source, {
      card: {
        attributes: { verification: { method: "SCA_WHEN_REQUIRED" } },
        experience_context: {
          return_url: `https://ahibizz.invalid/naplata/povratak?narudzba=${order.id}`,
          cancel_url: `https://ahibizz.invalid/naplata/odustajanje?narudzba=${order.id}`,
        },
      },
    });
    return Response.json({
      ...provider(),
      status: "CREATED",
      links: [{ rel: "payer-action", href: "https://issuer.invalid/challenge" }],
    });
  }) as typeof fetch;
  const paypal = createLivePayPal({ ...config, chargingApproved: true }, mock);
  assert.deepEqual(await paypal.create(order, "card-fields"), {
    providerOrderId: order.providerOrderId,
    approvalUrl: null,
  });
  await assert.rejects(
    paypal.create({ ...order, purpose: "support" }, "card-fields"),
    /INVALID_CHECKOUT_FLOW/,
  );
});

test("advanced card captures use the provider's SCA decision before any charge", async () => {
  const authentication = (liability: string, enrollment: string, status?: string) => ({
    liability_shift: liability,
    three_d_secure: { enrollment_status: enrollment, authentication_status: status },
  });
  const cases: [unknown, boolean][] = [
    [{}, true],
    [{ authentication_result: authentication("POSSIBLE", "Y", "Y") }, true],
    [{ authentication_result: authentication("POSSIBLE", "Y", "A") }, true],
    [{ authentication_result: authentication("NO", "N") }, true],
    [{ authentication_result: authentication("NO", "B") }, true],
    [{ authentication_result: authentication("NO", "Y", "R") }, false],
    [{ authentication_result: authentication("UNKNOWN", "Y", "C") }, false],
    [{ authentication_result: authentication("POSSIBLE", "Y", "N") }, false],
    [{ authentication_result: {} }, false],
    [undefined, false],
  ];
  for (const [card, canCapture] of cases) {
    let captureCount = 0;
    const mock = (async (url, init) => {
      if (String(url).endsWith("/token")) return Response.json({ access_token: "fixture" });
      if (init?.method === "POST") {
        assert.ok(String(url).endsWith("/capture"));
        assert.equal(new Headers(init.headers).get("PayPal-Request-Id"), order.captureRequestId);
        captureCount++;
        return Response.json(provider());
      }
      if (captureCount) return Response.json(provider());
      assert.equal(new URL(String(url)).searchParams.get("fields"), "payment_source");
      const uncharged = provider();
      Reflect.deleteProperty(uncharged.purchase_units[0] ?? {}, "payments");
      return Response.json({ ...uncharged, status: "APPROVED", payment_source: { card } });
    }) as typeof fetch;
    const operation = createLivePayPal({ ...config, chargingApproved: true }, mock).capture(
      order,
      "card-fields",
    );
    if (canCapture) assert.equal((await operation).status, "COMPLETED");
    else await assert.rejects(operation);
    assert.equal(captureCount, canCapture ? 1 : 0);
  }
});
test("redirect create retains wallet experience context and requires approval link", async () => {
  let body: Record<string, unknown> | null = null;
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "fixture" });
    body = JSON.parse(String(init?.body));
    return Response.json({
      id: "ORDER12345678",
      links: [
        { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=fixture" },
      ],
    });
  }) as typeof fetch;
  const result = await createLivePayPal(
    { ...config, chargingApproved: true, environment: "sandbox" },
    transport,
  ).create(order);
  assert.ok(body && Object.hasOwn(body, "payment_source"));
  assert.equal(result.approvalUrl, "https://www.sandbox.paypal.com/checkoutnow?token=fixture");
  assert.equal(JSON.stringify(body).includes("landing_page"), false);
});

test("guest handoff requests the hosted card landing and keeps the same return URLs and request ID", async () => {
  const approvalUrl = "https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345678";
  let links = [{ rel: "payer-action", href: approvalUrl }];
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "fixture" });
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.payment_source.paypal.experience_context, {
      landing_page: "GUEST_CHECKOUT",
      brand_name: "AhiBizz",
      locale: "en-BA",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: `${config.publicOrigin}/naplata/povratak?narudzba=${order.id}`,
      cancel_url: `${config.publicOrigin}/naplata/odustajanje?narudzba=${order.id}`,
    });
    assert.equal(new Headers(init?.headers).get("PayPal-Request-Id"), order.createRequestId);
    return Response.json({ id: "ORDER12345678", links });
  }) as typeof fetch;
  const paypal = createLivePayPal(
    { ...config, chargingApproved: true, environment: "sandbox" },
    transport,
  );
  assert.deepEqual(await paypal.create(order, "guest"), {
    providerOrderId: "ORDER12345678",
    approvalUrl,
  });
  links = [];
  await assert.rejects(paypal.create(order, "guest"), /INVALID_APPROVAL_URL/);
  links = [{ rel: "payer-action", href: "https://www.paypal.com/checkoutnow?token=fixture" }];
  await assert.rejects(paypal.create(order, "guest"), /INVALID_APPROVAL_URL/);
});
