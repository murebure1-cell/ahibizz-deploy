import assert from "node:assert/strict";
import test from "node:test";
import { readPackageSettlements } from "../src/lib/package-settlements";

const payment = {
  id: "PAYMENT-FIXTURE-1",
  businessTitle: "Fixture djelatnost",
  paidAt: "2026-11-20T08:00:00.000Z",
  amountEurMinor: 1483,
  status: "COMPLETED",
  needsReview: false,
  recorded: true,
};

test("package settlements expose only valid page and payment display fields", () => {
  assert.deepEqual(
    readPackageSettlements(
      { page: 2, more: false, items: [{ ...payment, private: "ignored" }] },
      2,
    ),
    { page: 2, more: false, items: [payment] },
  );
  assert.deepEqual(readPackageSettlements({ page: 1, more: false, items: [] }, 1), {
    page: 1,
    more: false,
    items: [],
  });
});

test("malformed successful package responses reject before rendering items", () => {
  for (const value of [
    null,
    {},
    [],
    { page: 1, more: false },
    { page: 1, more: false, items: {} },
    { page: 1, more: "false", items: [] },
    { page: 2, more: false, items: [] },
    { page: 1, more: false, items: [null] },
    { page: 1, more: false, items: [payment, payment] },
  ])
    assert.throws(() => readPackageSettlements(value, 1));
  for (const change of [
    { id: "" },
    { businessTitle: null },
    { paidAt: "not-a-date" },
    { amountEurMinor: 1.5 },
    { amountEurMinor: -1 },
    { amountEurMinor: "1483" },
    { status: "UNKNOWN" },
    { needsReview: "false" },
    { recorded: null },
  ])
    assert.throws(() =>
      readPackageSettlements({ page: 1, more: false, items: [{ ...payment, ...change }] }, 1),
    );
});

test("package settlements preserve all historical refund statuses and bounded pagination", () => {
  for (const status of ["COMPLETED", "REFUNDED", "REVERSED", "PARTIALLY_REFUNDED"])
    assert.equal(
      readPackageSettlements({ page: 1, more: false, items: [{ ...payment, status }] }, 1).items[0]
        ?.status,
      status,
    );
  for (const page of [0, 10000, 1.5])
    assert.throws(() => readPackageSettlements({ page, more: false, items: [] }, page));
});
