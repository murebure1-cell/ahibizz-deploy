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
  assert.equal(verifyLiveOrder(pending, order, false).status, "APPROVED");
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
