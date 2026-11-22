import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { BankTopUpRequest } from "../src/lib/bank-credit-topup";
import { creditTopUpStatusLabels, creditTopUpView } from "../src/lib/credit-topup-view";
import type { MarketingOrder } from "../src/lib/marketing";

const request: BankTopUpRequest = {
  id: "topup-fixture",
  orderId: "order-fixture",
  quantity: 60,
  amountMinor: 1500,
  originalBamMinor: 1500,
  currency: "BAM",
  paymentReference: "AHI-FIXTURE",
  status: "pending",
  version: 1,
  createdAt: "2026-11-20T10:00:00Z",
  approvedAt: null,
  instructionsAvailable: false,
  bank: {
    id: "fixture",
    label: "Fixture bank",
    name: "Fixture bank",
    recipient: "Fixture recipient",
    currency: "BAM",
    purpose: "Dopuna Ahi kredita",
  },
};
const order: MarketingOrder = {
  id: request.orderId,
  kind: "credits",
  status: "closed",
  quantity: 60,
  amountMinor: 1500,
  creditPrice: null,
  instructions: null,
  businessTitle: null,
  customer: "Fixture customer",
  startsAt: null,
  endsAt: null,
};

test("a bank request and its marketing order appear only once even without the legacy bank flag", () => {
  const view = creditTopUpView([{ ...request, status: "cancelled", version: 2 }], [order]);
  assert.equal(view.pendingBank, undefined);
  assert.equal(view.history.length, 1);
  assert.deepEqual(view.orders, []);
});

test("the newest bank request version wins over stale pending and duplicate history rows", () => {
  const cancelled = { ...request, status: "cancelled" as const, version: 2 };
  for (const rows of [
    [request, cancelled, cancelled],
    [cancelled, request],
  ]) {
    const view = creditTopUpView(rows, []);
    assert.equal(view.pendingBank, undefined);
    assert.equal(view.history.length, 1);
    assert.ok(view.history[0]);
    assert.equal(view.history[0].status, "cancelled");
  }
});

test("one current bank request stays separate from finished top-ups with clear statuses", () => {
  const approved = { ...request, id: "old", orderId: "old-order", status: "approved" as const };
  const view = creditTopUpView(
    [request, approved],
    [
      { ...order, id: "legacy-paid", status: "paid" },
      { ...order, id: "legacy-cancelled" },
      { ...order, id: "photo-order", kind: "photo" },
    ],
  );
  assert.equal(view.pendingBank?.id, request.id);
  assert.equal(view.history.length, 3);
  assert.deepEqual(
    view.orders.map((value) => value.id),
    ["photo-order"],
  );
  assert.deepEqual(creditTopUpStatusLabels, {
    pending: "Na čekanju",
    approved: "Potvrđeno",
    cancelled: "Otkazano",
  });
});

test("finished top-ups are inside collapsed history and the pending request has payment instructions", () => {
  const workspace = readFileSync("src/components/marketing/MarketingWorkspace.tsx", "utf8");
  assert.match(workspace, /<details[^>]*>\s*<summary>Historija dopuna<\/summary>/);
  assert.match(workspace, /<CreditBankTransfer request=\{pendingBank\}/);
  assert.doesNotMatch(workspace, /<h2>Bankovne uplate<\/h2>/);
});

test("legacy open online top-ups keep their status route while bank-linked orders stay hidden", () => {
  const pendingOnline = {
    ...order,
    id: "online-order",
    status: "quoted" as const,
    onlinePending: true,
  };
  const flagged = { ...order, id: "other-page-bank-order", bankTopUp: true };
  const view = creditTopUpView([], [pendingOnline, flagged]);
  assert.deepEqual(view.orders, [pendingOnline]);
  assert.deepEqual(view.history, []);
});
