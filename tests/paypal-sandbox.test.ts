import assert from "node:assert/strict";
import test from "node:test";
import {
  createSandboxPayPal,
  sandboxApprovalUrl,
  sandboxQuote,
  verifySandboxCapture,
} from "../src/server/paypal-sandbox";

const completed = () => ({
  id: "ORDER1234567",
  status: "COMPLETED",
  purchase_units: [
    {
      payee: { merchant_id: "TESTMERCHANT" },
      payments: {
        captures: [
          {
            id: "CAPTURE123",
            status: "COMPLETED",
            amount: { currency_code: "EUR", value: "5.11" },
          },
        ],
      },
    },
  ],
});
function unit(x: ReturnType<typeof completed>) {
  const value = x.purchase_units[0];
  assert.ok(value);
  return value;
}
function capture(x: ReturnType<typeof completed>) {
  const value = unit(x).payments.captures[0];
  assert.ok(value);
  return value;
}
test("sandbox amounts keep BAM separate and never send ten EUR", () => {
  assert.equal(sandboxQuote("promotion").value, "5.11");
  assert.equal(sandboxQuote("promotion").currency, "EUR");
  assert.equal(sandboxQuote("support").value, "1.00");
});
test("sandbox redirects reject live, lookalike and credential URLs", () => {
  assert.equal(
    sandboxApprovalUrl("https://www.sandbox.paypal.com/checkoutnow?token=TEST"),
    "https://www.sandbox.paypal.com/checkoutnow?token=TEST",
  );
  for (const url of [
    "https://www.paypal.com/checkoutnow",
    "https://www.sandbox.paypal.com.evil.test/",
    "http://www.sandbox.paypal.com/",
    "https://user@www.sandbox.paypal.com/",
  ])
    assert.throws(() => sandboxApprovalUrl(url));
});
test("capture proves id, status, merchant, amount and currency", () => {
  assert.equal(
    verifySandboxCapture(completed(), "ORDER1234567", "promotion", "TESTMERCHANT").sandbox,
    true,
  );
  for (const change of [
    (x: ReturnType<typeof completed>) => {
      x.status = "APPROVED";
    },
    (x: ReturnType<typeof completed>) => {
      x.id = "OTHER123456";
    },
    (x: ReturnType<typeof completed>) => {
      unit(x).payee.merchant_id = "OTHER";
    },
    (x: ReturnType<typeof completed>) => {
      capture(x).amount.value = "10.00";
    },
    (x: ReturnType<typeof completed>) => {
      capture(x).amount.currency_code = "BAM";
    },
    (x: ReturnType<typeof completed>) => {
      capture(x).status = "PENDING";
    },
  ]) {
    const value = completed();
    change(value);
    assert.throws(() => verifySandboxCapture(value, "ORDER1234567", "promotion", "TESTMERCHANT"));
  }
});
test("provider transport is sandbox-only and repeated completed capture does not charge again", async () => {
  const urls: string[] = [];
  const transport = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return Response.json(
      String(url).endsWith("/token") ? { access_token: "fixture-only" } : completed(),
    );
  }) as typeof fetch;
  const client = createSandboxPayPal(
    { clientId: "fixture", secret: "fixture", merchantId: "TESTMERCHANT" },
    transport,
  );
  await client.capture("ORDER1234567", "promotion", "idempotency-fixture");
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.startsWith("https://api-m.sandbox.paypal.com/")));
  assert.ok(urls.every((url) => !url.endsWith("/capture")));
});

test("minimal capture response is re-read before showing success", async () => {
  let read = 0;
  const urls: string[] = [];
  const transport = (async (url: string | URL | Request) => {
    const path = String(url);
    urls.push(path);
    if (path.endsWith("/token")) return Response.json({ access_token: "fixture-only" });
    if (path.endsWith("/capture"))
      return Response.json({ id: "ORDER1234567", status: "COMPLETED" });
    read += 1;
    return Response.json(read === 1 ? { status: "APPROVED" } : completed());
  }) as typeof fetch;
  const client = createSandboxPayPal(
    { clientId: "fixture", secret: "fixture", merchantId: "TESTMERCHANT" },
    transport,
  );
  assert.equal((await client.capture("ORDER1234567", "promotion", "same-key")).id, "CAPTURE123");
  assert.equal(urls.filter((url) => url.endsWith("/capture")).length, 1);
  assert.equal(read, 2);
});
