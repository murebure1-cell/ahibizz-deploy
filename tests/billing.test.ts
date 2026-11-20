import assert from "node:assert/strict";
import test from "node:test";
import {
  BillingRequestError,
  billingActorRequest,
  billingAllocation,
  billingMoney,
  billingRequest,
} from "../src/lib/billing";
import { getBillingCatalog } from "../src/server/billing";
import { adjustmentInput, BillingAccessError, createInput } from "../src/server/billing/validation";
import { createBillingRequestHandler } from "../src/server/billing-http";

const input = {
  kind: "subscription" as const,
  packageId: "basic" as const,
  period: "annual" as const,
  businessId: "11111111-1111-4111-8111-111111111111",
  source: "bank" as const,
  externalReference: "BANK-001",
  receivedAt: "2026-01-01T12:00:00Z",
  grossMinor: 10000,
  taxMinor: null,
  feeMinor: null,
  serviceStartsOn: "2026-01-01",
  serviceEndsOn: "2027-01-01",
};
test("confirmed catalog separates actual annual prices, fixed monthly commitment and draft readiness", () => {
  const value = getBillingCatalog();
  assert.equal(value.currency, "BAM");
  assert.equal(value.version, 1);
  assert.deepEqual(
    value.packages.map((row) => [
      row.monthlyMinor,
      row.annualMinor,
      row.monthlyMinor * value.monthlyCommitmentMonths,
    ]),
    [
      [2900, 29000, 34800],
      [4900, 49000, 58800],
      [8900, 89000, 106800],
    ],
  );
  assert.equal(value.developmentRateBps, 2000);
  assert.equal(value.contractStatus, "draft");
  assert.equal(value.operatorStatus, "unconfirmed");
  assert.equal(value.checkoutEnabled, false);
  assert.equal(value.automaticCharging, false);
  assert.equal(value.membershipActivation, false);
});
test("unknown deductions remain pending; explicit zero permits an integer-cent calculated earmark", () => {
  const facts = {
    kind: "subscription" as const,
    grossMinor: 2900,
    refundedMinor: 0,
    taxMinor: null,
    feeMinor: null,
    developmentRateBps: 2000,
  };
  assert.deepEqual(billingAllocation(facts), {
    netBaseMinor: null,
    developmentMinor: null,
    allocationStatus: "pending",
  });
  assert.deepEqual(billingAllocation({ ...facts, taxMinor: 0, feeMinor: 0 }), {
    netBaseMinor: 2900,
    developmentMinor: 580,
    allocationStatus: "posted",
  });
  assert.deepEqual(
    billingAllocation({ ...facts, taxMinor: 0, feeMinor: 0, developmentRateBps: null }),
    { netBaseMinor: 2900, developmentMinor: null, allocationStatus: "pending" },
  );
  assert.deepEqual(
    billingAllocation({ ...facts, taxMinor: 800, feeMinor: 300, refundedMinor: 2000 }),
    { netBaseMinor: 0, developmentMinor: 0, allocationStatus: "posted" },
  );
});
test("rounding is half-up in minor units and photo/video never automatically allocates", () => {
  const facts = {
    kind: "subscription" as const,
    grossMinor: 5,
    refundedMinor: 0,
    taxMinor: 0,
    feeMinor: 0,
    developmentRateBps: 1000,
  };
  assert.equal(billingAllocation(facts).developmentMinor, 1);
  assert.equal(billingAllocation({ ...facts, grossMinor: 4 }).developmentMinor, 0);
  assert.deepEqual(billingAllocation({ ...facts, kind: "photo_video" }), {
    netBaseMinor: 5,
    developmentMinor: null,
    allocationStatus: "not_applicable",
  });
  assert.throws(() => billingAllocation({ ...facts, grossMinor: 1.5 }));
  assert.throws(() => billingAllocation({ ...facts, refundedMinor: 6 }));
  assert.throws(() => billingAllocation({ ...facts, developmentRateBps: 10001 }));
  assert.equal(
    billingAllocation({ ...facts, grossMinor: 1000000000, developmentRateBps: 2000 })
      .developmentMinor,
    200000000,
  );
  assert.match(billingMoney(-123), /-1,23 KM/);
});
test("cash facts do not enforce price equality, but subscription dates and immutable payload shape are strict", () => {
  assert.equal(createInput(input).grossMinor, 10000);
  assert.equal(createInput(input).receivedAt, "2026-01-01T12:00:00.000Z");
  for (const invalid of [
    { ...input, serviceStartsOn: null, serviceEndsOn: null },
    { ...input, serviceEndsOn: "2026-01-01" },
    { ...input, serviceEndsOn: "2026-02-30" },
    { ...input, grossMinor: 0 },
    { ...input, feeMinor: -1 },
    { ...input, verified: true },
    { ...input, developmentRateBps: 0 },
    { ...input, source: "processor" },
    { ...input, receivedAt: "2026-01-01T12:00:00+01:00" },
    { ...input, externalReference: "ref\n1" },
  ])
    assert.throws(() => createInput(invalid), BillingAccessError);
  const photo = createInput({
    ...input,
    kind: "photo_video",
    packageId: null,
    period: null,
    businessId: null,
    serviceStartsOn: null,
    serviceEndsOn: null,
  });
  assert.equal(photo.businessId, null);
  assert.throws(() =>
    adjustmentInput({ expectedVersion: 1, refundedMinor: 0, reason: "Known facts" }),
  );
  assert.throws(() =>
    adjustmentInput({
      expectedVersion: 1,
      refundedMinor: 0,
      taxMinor: 0,
      feeMinor: 0,
      reason: "x",
    }),
  );
});
test("public catalog has no database/auth dependency and private routes stay gated", async () => {
  let reads = 0;
  const handle = createBillingRequestHandler({
    configuration: () => {
      reads++;
      return null;
    },
    privateService: () => null,
  });
  const result = await handle(new Request("https://fixture.invalid/api/billing/catalog"));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await result.json()).catalog.packages[0].monthlyMinor, 2900);
  assert.equal(reads, 0);
  assert.equal(
    (await handle(new Request("https://fixture.invalid/api/billing/catalog?unknown=1"))).status,
    400,
  );
  assert.equal(
    (await handle(new Request("https://fixture.invalid/api/billing/admin"))).status,
    503,
  );
  assert.equal(reads, 1);
});
test("client financial requests preserve the exact actor, command key/body and safe private route", async () => {
  const old = globalThis.fetch;
  const calls: { url: string; options: RequestInit }[] = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return Response.json({ actor: { id: "admin-A", role: "owner" }, receipt: null });
  };
  try {
    const request = billingActorRequest("admin-A");
    const body = JSON.stringify(input);
    await request("admin/receipts", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": "original-key", "X-AhiBizz-Account-ID": "other" },
    });
    assert.equal(calls[0]?.url, "/api/billing/admin/receipts");
    assert.equal(calls[0]?.options.body, body);
    assert.equal(new Headers(calls[0]?.options.headers).get("Idempotency-Key"), "original-key");
    assert.equal(new Headers(calls[0]?.options.headers).get("X-AhiBizz-Account-ID"), "admin-A");
    assert.equal(calls[0]?.options.redirect, "error");
    assert.equal(calls[0]?.options.cache, "no-store");
    for (const path of [
      "../account/profile",
      "admin/../receipts",
      "admin/receipts?owner=other",
      "admin/businesses?page=1&q=x#bad",
      "admin?page=1&page=2",
      "admin/pending?page=1&extra=1",
    ])
      await assert.rejects(billingRequest(path), BillingRequestError);
    await assert.rejects(billingActorRequest(undefined)("admin"), BillingRequestError);
    assert.equal(calls.length, 1);
    await request("admin/pending?page=1");
    assert.equal(calls[1]?.url, "/api/billing/admin/pending?page=1");
  } finally {
    globalThis.fetch = old;
  }
});
