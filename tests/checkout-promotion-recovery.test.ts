import assert from "node:assert/strict";
import test from "node:test";
import {
  canCancelPromotionOrder,
  cancelPromotionOrder,
  findPendingPromotion,
  promotionRestartHref,
} from "../src/lib/checkout-promotion-recovery";
import type { CardOrder } from "../src/lib/paypal-card-flow";

const order: CardOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  businessId: "33333333-3333-4333-8333-333333333333",
  businessTitle: "Fixture business",
  kind: "promotion",
  status: "provider_created",
  flow: "redirect",
  environment: "live",
  amountMinor: 511,
  currency: "EUR",
  refundedMinor: 0,
  endsAt: null,
};

test("only a known unpaid one-time promotion offers cancellation", () => {
  assert.equal(canCancelPromotionOrder(order), true);
  for (const flow of [undefined, "redirect", "sdk", "guest", "card-fields"] as const)
    assert.equal(canCancelPromotionOrder({ ...order, flow }), true);
  for (const status of [
    "created",
    "capturing",
    "captured",
    "review",
    "cancelled",
    "refunded",
    "partially_refunded",
    "reversed",
    "unknown",
  ])
    assert.equal(canCancelPromotionOrder({ ...order, status }), false, status);
  for (const patch of [
    { kind: "support" },
    { kind: "quote", quoteId: order.id },
    { kind: "subscription" },
    { id: "unknown" },
    { requestId: "unknown" },
    { businessId: null },
    { refundedMinor: 1 },
    { endsAt: "2026-11-30T00:00:00Z" },
    { amountMinor: 0 },
    { currency: "BAM" },
  ])
    assert.equal(canCancelPromotionOrder({ ...order, ...patch } as CardOrder), false);
  assert.equal(canCancelPromotionOrder(null), false);
});

test("cancellation posts exactly one empty request for the existing order", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const cancelled = { ...order, status: "cancelled" };
  assert.deepEqual(
    await cancelPromotionOrder(order, async (path, body) => {
      calls.push({ path, body });
      return { order: cancelled };
    }),
    cancelled,
  );
  assert.deepEqual(calls, [{ path: `orders/${order.id}/cancel`, body: {} }]);
});

test("uncertain cancellation never retries or infers success", async () => {
  let calls = 0;
  const failure = new Error("ORDER_CANCELLATION_UNAVAILABLE");
  await assert.rejects(
    cancelPromotionOrder(order, async () => {
      calls++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  assert.equal(order.status, "provider_created");
});

test("cancellation rejects altered identity, paid state and ambiguous response before resetting", async () => {
  const cancelled = { ...order, status: "cancelled" };
  for (const patch of [
    { id: order.requestId },
    { requestId: order.id },
    { businessId: order.id },
    { amountMinor: 1022 },
    { flow: "card-fields" },
    { environment: "sandbox" },
    { status: "captured" },
    { status: "review" },
    { refundedMinor: 511 },
  ])
    await assert.rejects(
      cancelPromotionOrder(order, async () => ({ order: { ...cancelled, ...patch } })),
    );
  for (const response of [null, {}, { order: null }, { order: cancelled, pending: true }])
    await assert.rejects(cancelPromotionOrder(order, async () => response));
  let attempts = 0;
  await assert.rejects(
    cancelPromotionOrder({ ...order, status: "captured" }, async () => {
      attempts++;
    }),
  );
  assert.equal(attempts, 0);
});

test("lookup reads only the selected business and accepts no-order without inventing an ID", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const send = async (path: string, body?: unknown) => {
    calls.push({ path, body });
    return { order: null };
  };
  assert.equal(await findPendingPromotion(order.businessId ?? "", send), null);
  assert.deepEqual(calls, [{ path: `pending-promotion/${order.businessId}`, body: undefined }]);
  for (const status of ["created", "provider_created"])
    assert.deepEqual(
      await findPendingPromotion(order.businessId ?? "", async () => ({
        order: { ...order, status },
      })),
      { ...order, status },
    );
});

test("lookup cannot load another business, terminal/review purchase or guessed identifier", async () => {
  for (const patch of [
    { businessId: order.id },
    { kind: "quote" },
    { status: "captured" },
    { status: "review" },
    { status: "cancelled" },
    { id: "unknown-order" },
  ])
    await assert.rejects(
      findPendingPromotion(order.businessId ?? "", async () => ({ order: { ...order, ...patch } })),
    );
  let calls = 0;
  await assert.rejects(
    findPendingPromotion("../another-business", async () => {
      calls++;
      return { order };
    }),
  );
  assert.equal(calls, 0);
});

test("restart is offered only after confirmed closure and retains only the same business", () => {
  assert.equal(promotionRestartHref(order), null);
  assert.equal(promotionRestartHref({ ...order, status: "review" }), null);
  assert.equal(promotionRestartHref({ ...order, status: "captured" }), null);
  assert.equal(promotionRestartHref({ ...order, status: "cancelled", kind: "quote" }), null);
  const href = promotionRestartHref({ ...order, status: "cancelled" });
  assert.ok(href);
  const target = new URL(href, "https://checkout-fixture.invalid");
  assert.equal(target.pathname, "/naplata");
  assert.deepEqual([...target.searchParams], [["djelatnost", order.businessId]]);
  assert.equal(target.hash, "");
  assert.equal(target.searchParams.has("narudzba"), false);
  assert.equal(target.searchParams.has("ponuda"), false);
  assert.equal(promotionRestartHref({ ...order, status: "cancelled", refundedMinor: 1 }), null);
});

test("credit card recovery requires the same linked top-up and no PayPal redirect flow", async () => {
  const credit: CardOrder = {
    ...order,
    kind: "quote",
    quoteKind: "credits",
    quoteId: order.businessId,
    businessId: null,
    businessTitle: null,
    flow: "sdk",
  };
  const cancelled = { ...credit, status: "cancelled" };
  assert.equal(canCancelPromotionOrder(credit), true);
  assert.equal(promotionRestartHref(credit), null);
  for (const patch of [
    { flow: "redirect" },
    { flow: "guest" },
    { quoteId: undefined },
    { quoteId: "wrong" },
    { quoteKind: "category" },
    { businessId: order.businessId },
  ] as Partial<CardOrder>[]) {
    assert.equal(canCancelPromotionOrder({ ...credit, ...patch }), false);
    assert.equal(promotionRestartHref({ ...cancelled, ...patch }), null);
  }
  await assert.rejects(
    cancelPromotionOrder(credit, async () => ({ order: { ...cancelled, quoteId: order.id } })),
  );
  assert.deepEqual(
    await cancelPromotionOrder(credit, async () => ({ order: cancelled })),
    cancelled,
  );
  assert.equal(promotionRestartHref(cancelled), `/naplata?ponuda=${credit.quoteId}&nacin=kartica`);
});
