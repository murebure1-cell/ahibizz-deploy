import assert from "node:assert/strict";
import test from "node:test";
import {
  type CardOrder,
  canOfferPayPalCard,
  createPayPalCardFlow,
} from "../src/lib/paypal-card-flow";

const order: CardOrder = {
  id: "internal-id",
  requestId: "original-key",
  kind: "promotion",
  businessId: "business",
  businessTitle: "Business",
  amountMinor: 511,
  currency: "EUR",
  environment: "sandbox",
  status: "created",
  refundedMinor: 0,
  endsAt: null,
  flow: "sdk",
};
const providerOrderId = "TESTORDER123456";
function setup(send?: Parameters<typeof createPayPalCardFlow>[0]["send"], saved?: CardOrder) {
  const calls: { path: string; body: unknown }[] = [];
  const updates: CardOrder[] = [];
  let locks = 0;
  const flow = createPayPalCardFlow({
    input: () => ({ requestId: saved?.requestId ?? "stable-key", businessId: "business" }),
    savedOrder: () => saved,
    acquire: () => {
      if (locks) return false;
      locks++;
      return true;
    },
    release: () => {
      locks--;
    },
    onOrder: (value) => updates.push(value),
    send: async (path, body, signal) => {
      calls.push({ path, body });
      return send
        ? send(path, body, signal)
        : path === "orders"
          ? { order, providerOrderId }
          : { order: { ...order, status: "captured" } };
    },
  });
  return { flow, calls, updates, locks: () => locks };
}
test("CARD is only offered for reviewed promotions and eligible open card orders", () => {
  assert.equal(canOfferPayPalCard(null, false, "promotion"), false);
  assert.equal(canOfferPayPalCard(null, true, "promotion"), true);
  assert.equal(canOfferPayPalCard(null, true, "support"), false);
  for (const status of ["captured", "cancelled", "refunded", "review", "reversed"])
    assert.equal(canOfferPayPalCard({ ...order, status }, true, "promotion"), false);
  assert.equal(canOfferPayPalCard({ ...order, flow: "redirect" }, true, "promotion"), false);
  assert.equal(canOfferPayPalCard(order, false, "promotion"), true);
});
test("SDK click creates once with stable server request and captures only exact approval", async () => {
  const t = setup();
  await assert.rejects(t.flow.create());
  assert.equal(t.flow.click(), true);
  assert.equal(t.flow.click(), false);
  const [a, b] = await Promise.all([t.flow.create(), t.flow.create()]);
  assert.equal(a, providerOrderId);
  assert.equal(b, a);
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0]?.body, {
    requestId: "stable-key",
    businessId: "business",
    kind: "promotion",
    flow: "sdk",
  });
  assert.equal(t.updates[0]?.requestId, "original-key"); // server may safely resume an existing order
  await assert.rejects(t.flow.approve("OTHERORDER12345"));
  assert.equal(t.calls.length, 1);
  await t.flow.approve(providerOrderId);
  await t.flow.approve(providerOrderId);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1]?.path, "orders/internal-id/capture");
  assert.deepEqual(t.calls[1]?.body, {});
  assert.equal(t.locks(), 0);
});
test("cancel and disposal cannot capture, and no mutation retry is automatic", async () => {
  const t = setup();
  t.flow.click();
  await t.flow.create();
  t.flow.cancel();
  await assert.rejects(t.flow.approve(providerOrderId));
  assert.equal(t.calls.length, 1);
  t.flow.dispose();
  await assert.rejects(t.flow.approve(providerOrderId));
  const broken = setup(async () => {
    throw new Error("network");
  });
  broken.flow.click();
  await assert.rejects(broken.flow.create());
  assert.equal(broken.calls.length, 1);
  assert.equal(broken.locks(), 0);
});
test("late create after disposal cannot update identity or capture", async () => {
  let resolve!: (value: { order: CardOrder; providerOrderId: string }) => void;
  const t = setup(
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  t.flow.click();
  const pending = t.flow.create();
  t.flow.dispose();
  resolve({ order, providerOrderId });
  await assert.rejects(pending);
  assert.equal(t.updates.length, 0);
  assert.equal(t.calls.length, 1);
});
test("wrong server identity/price cannot be offered to SDK and pending is not success", async () => {
  for (const patch of [
    { businessId: "other" },
    { amountMinor: 999 },
    { flow: "redirect" as const },
  ]) {
    const t = setup(async () => ({ order: { ...order, ...patch }, providerOrderId }));
    t.flow.click();
    await assert.rejects(t.flow.create());
    assert.equal(t.calls.length, 1);
  }
  const t = setup(async (path) =>
    path === "orders" ? { order, providerOrderId } : { order, pending: true },
  );
  t.flow.click();
  await t.flow.create();
  await assert.rejects(t.flow.approve(providerOrderId), /još nije potvrđena/);
});

test("saved guest checkout resumes the exact existing order and cannot fall through to creating another one", async () => {
  const guest: CardOrder = {
    ...order,
    flow: "guest",
    status: "provider_created",
    id: "saved guest",
  };
  assert.equal(canOfferPayPalCard(guest, false, "promotion"), true);
  for (const status of ["created", "capturing", "captured", "cancelled", "refunded", "review"])
    assert.equal(canOfferPayPalCard({ ...guest, status }, false, "promotion"), false);
  const t = setup(
    async (path) =>
      path.endsWith("/capture")
        ? { order: { ...guest, status: "captured" } }
        : { order: guest, providerOrderId },
    guest,
  );
  assert.equal(t.flow.click(), true);
  assert.deepEqual(await Promise.all([t.flow.create(), t.flow.create()]), [
    providerOrderId,
    providerOrderId,
  ]);
  assert.deepEqual(t.calls, [{ path: "orders/saved%20guest/card-session", body: {} }]);
  await assert.rejects(t.flow.approve("WRONGORDER12345"));
  assert.equal(t.calls.length, 1);
  await t.flow.approve(providerOrderId);
  assert.equal(t.calls.length, 2);
  assert.equal(t.updates.at(-1)?.status, "captured");
});
test("failed or mismatched guest recovery cannot issue a new create, retain a provider ID or capture", async () => {
  const guest: CardOrder = { ...order, flow: "guest", status: "provider_created" };
  for (const invalid of [
    { ...guest, id: "other" },
    { ...guest, requestId: "other" },
    { ...guest, flow: "sdk" as const },
    { ...guest, environment: "live" as const },
    { ...guest, amountMinor: 1000 },
  ]) {
    const t = setup(async () => ({ order: invalid, providerOrderId }), guest);
    t.flow.click();
    await assert.rejects(t.flow.create());
    await assert.rejects(t.flow.approve(providerOrderId));
    assert.deepEqual(t.calls, [{ path: "orders/internal-id/card-session", body: {} }]);
    assert.equal(t.locks(), 0);
  }
  const unavailable = setup(async () => {
    throw new Error("Order expired");
  }, guest);
  unavailable.flow.click();
  await assert.rejects(unavailable.flow.create());
  assert.equal(unavailable.calls.length, 1);
  const redirect = setup(undefined, { ...guest, flow: "redirect" });
  redirect.flow.click();
  await assert.rejects(redirect.flow.create());
  assert.equal(redirect.calls.length, 0);
});

test("late capture response after cancel cannot release or complete a later card attempt", async () => {
  let finish!: (value: { order: CardOrder }) => void;
  const t = setup(async (path) =>
    path.endsWith("/capture")
      ? new Promise((r) => {
          finish = r;
        })
      : { order, providerOrderId },
  );
  t.flow.click();
  await t.flow.create();
  const first = t.flow.approve(providerOrderId);
  t.flow.cancel();
  t.flow.click();
  await t.flow.create();
  finish({ order: { ...order, status: "captured" } });
  await assert.rejects(first);
  assert.equal(t.locks(), 1);
  assert.equal(
    t.updates.some((o) => o.status === "captured"),
    false,
  );
  t.flow.dispose();
});
