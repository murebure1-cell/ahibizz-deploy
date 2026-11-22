import assert from "node:assert/strict";
import test from "node:test";
import {
  packageQuote,
  sandboxConfig,
  subscriptionConfig,
} from "../src/server/paypal-subscriptions/config";
import {
  createSandboxProvider,
  createSubscriptionProvider,
  sandboxSubscriptionApproval,
  subscriptionApproval,
  verifiedSandboxPayment,
  verifySandboxPlan,
} from "../src/server/paypal-subscriptions/provider";
import type { SandboxRecord } from "../src/server/paypal-subscriptions/service";

const id = "c07c9457-b1de-4230-aad7-41a353c4d581";
const record: SandboxRecord = {
  id,
  userId: "user",
  requestId: id,
  businessId: id,
  businessTitle: "Posao",
  packageId: "basic",
  period: "monthly",
  amountBamMinor: 2900,
  amountEurMinor: 1483,
  totalCycles: 12,
  planId: "P-TESTMONTHLY123456",
  providerId: "I-TESTSUB123456",
  approvalUrl: null,
  status: "APPROVAL_PENDING",
  providerUpdatedAt: null,
  startsAt: null,
  endsAt: null,
  paidCycles: 0,
  paidEurMinor: 0,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
};
const fixed = { currency_code: "EUR", value: "14.83" };
const plan = {
  id: record.planId,
  status: "ACTIVE",
  quantity_supported: false,
  billing_cycles: [
    {
      tenure_type: "REGULAR",
      sequence: 1,
      total_cycles: 12,
      frequency: { interval_unit: "MONTH", interval_count: 1 },
      pricing_scheme: { fixed_price: fixed },
    },
  ],
  payment_preferences: { setup_fee: { currency_code: "EUR", value: "0" } },
};
const config = {
  clientId: "fake",
  clientSecret: "fake",
  merchantId: "sandbox-merchant",
  webhookId: "",
  origin: "http://127.0.0.1:3000",
  plans: {},
};
const current = {
  id: record.providerId,
  plan_id: record.planId,
  custom_id: id,
  status: "ACTIVE",
  status_update_time: new Date().toISOString(),
  start_time: new Date().toISOString(),
};
test("closing an unpaid PayPal attempt checks the provider status before writing", async () => {
  let status = "APPROVAL_PENDING";
  let billing: Record<string, unknown> = {};
  let cancellations = 0;
  const adapter = createSubscriptionProvider("live", config, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api-m.paypal.com");
    if (url.pathname.endsWith("/token"))
      return Response.json({ access_token: "fixture", expires_in: 300 });
    if (url.pathname.endsWith("/cancel")) {
      assert.equal(init?.method, "POST");
      cancellations++;
      return new Response(null, { status: 204 });
    }
    return Response.json({ ...current, status, billing_info: billing });
  });
  billing = { cycle_executions: [{ cycles_completed: 1 }] };
  await assert.rejects(adapter.cancel(record, true), { code: "SUBSCRIPTION_PENDING_CHANGED" });
  billing = {};
  status = "ACTIVE";
  await assert.rejects(adapter.cancel(record, true), { code: "SUBSCRIPTION_PENDING_CHANGED" });
  status = "CANCELLED";
  await adapter.cancel(record, true);
  assert.equal(cancellations, 0);
  status = "APPROVAL_PENDING";
  await adapter.cancel(record, true);
  assert.equal(cancellations, 1);
});
test("sandbox gate uses only explicit sandbox configuration and six independently mapped finite plan IDs", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    AHIBIZZ_SANDBOX_SUBSCRIPTIONS_ENABLED: "true",
    PAYPAL_SANDBOX_CLIENT_ID: "fake",
    PAYPAL_SANDBOX_CLIENT_SECRET: "fake",
    BETTER_AUTH_URL: "http://127.0.0.1:3050",
  };
  for (const p of ["BASIC", "BUSINESS", "PREMIUM"])
    for (const period of ["MONTHLY", "ANNUAL"])
      env[`PAYPAL_SANDBOX_PLAN_${p}_${period}`] = `P-${p}${period}123`;
  assert.ok(sandboxConfig(env));
  assert.equal(sandboxConfig({ ...env, AHIBIZZ_SANDBOX_SUBSCRIPTIONS_ENABLED: "false" }), null);
  assert.equal(sandboxConfig({ ...env, BETTER_AUTH_URL: "http://danger.example" }), null);
  assert.equal(
    sandboxConfig({
      ...env,
      PAYPAL_SANDBOX_PLAN_PREMIUM_ANNUAL: env.PAYPAL_SANDBOX_PLAN_PREMIUM_MONTHLY,
    }),
    null,
  );
  assert.equal(
    sandboxConfig({ ...env, PAYPAL_SANDBOX_CLIENT_SECRET: "", PAYPAL_LIVE_CLIENT_SECRET: "fake" }),
    null,
  );
  assert.deepEqual(packageQuote("premium", "annual"), {
    amountBamMinor: 89000,
    amountEurMinor: 45505,
    totalCycles: 1,
  });
  assert.deepEqual(packageQuote("basic", "monthly"), {
    amountBamMinor: 2900,
    amountEurMinor: 1483,
    totalCycles: 12,
  });
});
test("remote plan amount, currency, tenure cycle count, tax and setup must match the reviewed finite offer", () => {
  verifySandboxPlan(plan, record);
  for (const value of [
    { ...plan, status: "INACTIVE" },
    { ...plan, id: "P-OTHER" },
    { ...plan, billing_cycles: [{ ...plan.billing_cycles[0], total_cycles: 0 }] },
    {
      ...plan,
      billing_cycles: [
        { ...plan.billing_cycles[0], frequency: { interval_unit: "DAY", interval_count: 1 } },
      ],
    },
    {
      ...plan,
      billing_cycles: [
        {
          ...plan.billing_cycles[0],
          pricing_scheme: { fixed_price: { currency_code: "EUR", value: "1" } },
        },
      ],
    },
    { ...plan, payment_preferences: { setup_fee: { currency_code: "EUR", value: "0.01" } } },
    { ...plan, taxes: { percentage: "17" } },
  ])
    assert.throws(() => verifySandboxPlan(value, record));
});
test("settlement proof is validated independently of provider activation, refunds and currency mismatches", async () => {
  const calls: { host: string; path: string; method: string }[] = [];
  const stamp = new Date().toISOString();
  const sale = {
    id: "SALE123456",
    time: stamp,
    status: "COMPLETED",
    amount_with_breakdown: { gross_amount: fixed },
  };
  let sub = { ...current };
  const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ host: url.hostname, path: url.pathname, method: init?.method ?? "GET" });
    const value = url.pathname.endsWith("token")
      ? { access_token: "sandboxToken", expires_in: 300 }
      : url.pathname.endsWith("transactions")
        ? { transactions: [sale] }
        : sub;
    return Response.json(value);
  };
  const adapter = createSandboxProvider(config, transport);
  const state = await adapter.inspect(record);
  assert.equal(state.status, "ACTIVE");
  assert.deepEqual(state.payments, [
    { id: sale.id, at: stamp, amountEurMinor: 1483, status: "COMPLETED" },
  ]);
  assert.ok(calls.every((c) => c.host === "api-m.sandbox.paypal.com"));
  sub = { ...current, custom_id: "different-contract" };
  await assert.rejects(adapter.inspect(record));
  for (const status of ["PENDING", "DECLINED", "FAILED"])
    assert.equal(verifiedSandboxPayment({ ...sale, status }, 1483), null);
  assert.throws(() =>
    verifiedSandboxPayment(
      {
        ...sale,
        amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "14.83" } },
      },
      1483,
    ),
  );
});
test("active subscriptions reconcile an initially empty PayPal report without inventing a payment", async () => {
  let report: unknown = {};
  const adapter = createSandboxProvider(config, async (input) => {
    const path = new URL(String(input)).pathname;
    const data = path.endsWith("token")
      ? { access_token: "sandboxToken", expires_in: 300 }
      : path.endsWith("transactions")
        ? report
        : {
            ...current,
            billing_info: {
              last_payment: { amount: fixed, time: current.start_time },
              cycle_executions: [{ sequence: 1, tenure_type: "REGULAR", cycles_completed: 1 }],
            },
          };
    return Response.json(data);
  });
  const pendingReport = await adapter.inspect(record);
  assert.equal(pendingReport.status, "ACTIVE");
  assert.equal(pendingReport.reportedCycles, 1);
  assert.equal(pendingReport.lastPaymentAt, current.start_time);
  assert.deepEqual(pendingReport.payments, []);
  for (const malformed of [null, [], { transactions: null }, { data: [] }]) {
    report = malformed;
    await assert.rejects(adapter.inspect(record));
  }
  report = {
    transactions: [
      {
        id: "SALE123456",
        status: "COMPLETED",
        time: current.start_time,
        amount_with_breakdown: { gross_amount: fixed },
      },
    ],
  };
  assert.equal((await adapter.inspect(record)).payments[0]?.amountEurMinor, 1483);
});
test("approval links are constrained to actual sandbox checkout origin and selected paths", () => {
  const valid = "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=FAKE";
  assert.equal(sandboxSubscriptionApproval(valid), valid);
  for (const url of [
    valid.replace("www.sandbox.paypal.com", "www.paypal.com"),
    valid.replace("www.sandbox.paypal.com", "signin.invalid"),
    valid.replace("/webapps/billing/subscriptions", "/different"),
  ])
    assert.throws(() => sandboxSubscriptionApproval(url));
});

test("live packages require the six live mappings and their own webhook and reject Sandbox approval", () => {
  assert.throws(() =>
    subscriptionApproval("https://www.sandbox.paypal.com/agreements/approve", "live"),
  );
  assert.equal(
    subscriptionApproval("https://www.paypal.com/agreements/approve", "live"),
    "https://www.paypal.com/agreements/approve",
  );
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    BETTER_AUTH_URL: "https://site.example",
    AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED: "true",
    PAYPAL_LIVE_CLIENT_ID: "test-id",
    PAYPAL_LIVE_CLIENT_SECRET: "test-only",
    PAYPAL_LIVE_MERCHANT_ID: "test-merchant",
    PAYPAL_LIVE_SUBSCRIPTION_WEBHOOK_ID: "test-hook",
  };
  for (const p of ["BASIC", "BUSINESS", "PREMIUM"])
    for (const period of ["MONTHLY", "ANNUAL"])
      env[`PAYPAL_LIVE_PLAN_${p}_${period}`] = `P-${p}${period}123`;
  assert.ok(subscriptionConfig("live", env));
  for (const key of [
    "PAYPAL_LIVE_PLAN_BUSINESS_ANNUAL",
    "PAYPAL_LIVE_SUBSCRIPTION_WEBHOOK_ID",
    "PAYPAL_LIVE_CLIENT_ID",
  ])
    assert.equal(subscriptionConfig("live", { ...env, [key]: "" }), null);
  assert.equal(subscriptionConfig("sandbox", env), null);
});
