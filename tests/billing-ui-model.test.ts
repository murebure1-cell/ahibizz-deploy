import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBillingOwner,
  billingDenied,
  billingInputValue,
  billingMoneyInput,
  billingUncertain,
  readBillingEntries,
  readBillingReceipt,
  readBillingSummary,
} from "../src/components/billing/model";
import {
  type BillingReceipt,
  BillingRequestError,
  billingActorRequest,
  billingAllocation,
  billingRequest,
} from "../src/lib/billing";

const id = "00000000-0000-4000-8000-000000000001";
function receipt(changes: Partial<BillingReceipt> = {}): BillingReceipt {
  const value = {
    id,
    kind: "subscription" as const,
    packageId: "business" as const,
    period: "monthly" as const,
    businessId: id,
    businessTitle: "Stvarna djelatnost",
    catalogVersion: 1,
    quotedPriceMinor: 4900,
    commitmentMonths: 12,
    commitmentTotalMinor: 58800,
    serviceStartsOn: "2026-11-01",
    serviceEndsOn: "2026-11-30",
    source: "bank" as const,
    externalReference: "FIXTURE-1",
    receivedAt: "2026-11-16T12:00:00Z",
    grossMinor: 5000,
    refundedMinor: 0,
    taxMinor: 0,
    feeMinor: 100,
    developmentRateBps: 2000,
    version: 1,
    createdAt: "2026-11-16T12:00:00Z",
    updatedAt: "2026-11-16T12:00:00Z",
    ...changes,
  };
  return { ...value, ...billingAllocation(value) };
}
test("localized money input keeps unknown distinct from confirmed zero and handles exact minor units", () => {
  assert.equal(billingMoneyInput("", true), null);
  assert.equal(billingMoneyInput("  ", true), null);
  assert.equal(billingMoneyInput("0", true), 0);
  assert.equal(billingMoneyInput("0,00", true), 0);
  assert.equal(billingMoneyInput("49,29"), 4929);
  assert.equal(billingMoneyInput("29.01"), 2901);
  assert.equal(billingMoneyInput("1,2"), 120);
  assert.equal(billingInputValue(null), "");
  assert.equal(billingInputValue(0), "0,00");
  for (const value of ["", "-1", "1e3", "1.000,00", "1,234", "NaN", "Infinity", "€20"])
    assert.throws(() => billingMoneyInput(value));
});
test("private billing responses must prove the exact displayed owner before accepting data", () => {
  assert.doesNotThrow(() =>
    assertBillingOwner({ actor: { id: "owner-A", role: "owner" } }, "owner-A"),
  );
  for (const reply of [{}, { actor: { id: "owner-B", role: "owner" } }])
    assert.throws(
      () => assertBillingOwner(reply as never, "owner-A"),
      (error) => error instanceof BillingRequestError && error.status === 401,
    );
  assert.throws(
    () => assertBillingOwner({ actor: { id: "owner-A", role: "member" } } as never, "owner-A"),
    (error) => error instanceof BillingRequestError && error.status === 403,
  );
});
test("business selection uses the actual closed billing transport with a literal encoded search", async (t) => {
  let called = "",
    actor = "";
  t.mock.method(
    globalThis,
    "fetch",
    async (path: Parameters<typeof fetch>[0], options?: RequestInit) => {
      called = String(path);
      actor = new Headers(options?.headers).get("X-AhiBizz-Account-ID") ?? "";
      return Response.json({
        actor: { id: "owner-A", role: "owner" },
        businesses: [],
        page: 1,
        hasMore: false,
      });
    },
  );
  await billingActorRequest(
    "owner-A",
    billingRequest,
  )(`admin/businesses?page=1&q=${encodeURIComponent("Eden & Tuzla")}`);
  assert.equal(called, "/api/billing/admin/businesses?page=1&q=Eden%20%26%20Tuzla");
  assert.equal(actor, "owner-A");
});
test("408 and malformed/server outcomes remain uncertain while definitive first rejections do not", () => {
  for (const failure of [
    new Error("network"),
    new BillingRequestError("TIMEOUT", 408),
    new BillingRequestError("UNAVAILABLE", 503),
  ])
    assert.equal(billingUncertain(failure), true);
  for (const status of [400, 401, 403, 404, 409, 422])
    assert.equal(billingUncertain(new BillingRequestError("REJECTED", status)), false);
  assert.equal(billingDenied(new BillingRequestError("OWNER_REQUIRED", 403)), true);
});
test("an untrusted actor in a successful reply clears privacy while retaining an uncertain money command", () => {
  for (const reply of [
    {},
    { actor: { id: "owner-B", role: "owner" } },
    { actor: { id: "owner-A", role: "member" } },
  ]) {
    let failure: unknown;
    try {
      assertBillingOwner(reply as never, "owner-A");
    } catch (error) {
      failure = error;
    }
    assert.equal(billingDenied(failure), true);
    assert.equal(billingUncertain(failure), true);
  }
  assert.equal(billingUncertain(new BillingRequestError("ACCOUNT_IDENTITY_CHANGED", 401)), false);
});
test("receipt validation rejects a fake gross-based allocation and never converts unknown fees to zero", () => {
  const valid = receipt();
  assert.deepEqual(readBillingReceipt(valid), valid);
  assert.equal(valid.developmentMinor, 980);
  assert.throws(() => readBillingReceipt({ ...valid, developmentMinor: 1000 }));
  const unknown = receipt({ feeMinor: null });
  assert.equal(readBillingReceipt(unknown).netBaseMinor, null);
  assert.equal(unknown.developmentMinor, null);
  assert.equal(unknown.allocationStatus, "pending");
  assert.throws(() => readBillingReceipt({ ...unknown, netBaseMinor: 5000 }));
});
test("photo/video receipts remain separate from subscription development allocation", () => {
  const value = receipt({
    kind: "photo_video",
    packageId: null,
    period: null,
    businessId: null,
    businessTitle: null,
    catalogVersion: null,
    quotedPriceMinor: null,
    commitmentMonths: null,
    commitmentTotalMinor: null,
    serviceStartsOn: null,
    serviceEndsOn: null,
    developmentRateBps: null,
  });
  assert.equal(readBillingReceipt(value).allocationStatus, "not_applicable");
  assert.equal(value.developmentMinor, null);
  assert.doesNotThrow(() =>
    readBillingReceipt({
      ...value,
      businessId: id,
      businessTitle: "Povezani foto posao",
      serviceStartsOn: "2026-11-01",
      serviceEndsOn: "2026-11-02",
    }),
  );
  assert.throws(() => readBillingReceipt({ ...value, developmentMinor: 980 }));
});
test("private summary and append-only development rows reject malformed money and support real negative correction deltas", () => {
  const summary = {
    receiptCount: 1,
    grossMinor: 5000,
    refundedMinor: 0,
    developmentPostedMinor: 980,
    allocationPendingCount: 0,
    photoVideoGrossMinor: 0,
    knownNetBaseMinor: 4900,
    unknownNetCount: 0,
    unknownNetCashMinor: 0,
  };
  assert.deepEqual(readBillingSummary(summary), summary);
  assert.throws(() => readBillingSummary({ ...summary, knownNetBaseMinor: undefined }));
  const entry = {
    id,
    receiptId: id,
    receiptVersion: 2,
    externalReference: "FIXTURE-1",
    deltaMinor: -200,
    createdAt: "2026-11-16T12:00:00Z",
    reason: "Evidentiran izvršeni povrat",
  };
  assert.deepEqual(readBillingEntries([entry]), [entry]);
  assert.throws(() => readBillingEntries([entry, entry]));
});
