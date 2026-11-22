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
test("credit top-up shows only the embedded card option when explicitly enabled", () => {
  assert.equal(canOfferPayPalCard(null, true, "quote", "credits"), false);
  assert.equal(canOfferPayPalCard(null, false, "quote", "credits", true), false);
  assert.equal(canOfferPayPalCard(null, true, "quote", "credits", true), true);
  for (const flow of ["sdk", "guest", "card-fields"] as const) {
    const saved = {
      ...order,
      kind: "quote" as const,
      quoteId: "top-up-quote",
      quoteKind: "credits",
      status: "provider_created",
      flow,
    };
    assert.equal(canOfferPayPalCard(saved, true, "quote"), false);
    assert.equal(canOfferPayPalCard(saved, true, "quote", undefined, true), flow === "sdk");
    assert.equal(canOfferPayPalCard({ ...saved, quoteKind: "banner" }, true, "quote"), true);
  }
});
test("an enabled credit top-up uses the exact quote and captures only once", async () => {
  const quote: CardOrder = {
    ...order,
    kind: "quote",
    quoteId: "top-up-quote",
    quoteKind: "credits",
    businessId: null,
    amountMinor: 767,
  };
  for (const [enabled, method] of [
    [false, "sdk"],
    [true, "card-fields"],
    [true, "sdk"],
  ] as const) {
    const calls: { path: string; body: unknown }[] = [];
    const updates: CardOrder[] = [];
    const flow = createPayPalCardFlow({
      creditCardTopUps: enabled,
      input: () => ({
        requestId: "stable-key",
        quoteId: "top-up-quote",
        quoteKind: "credits",
        amountMinor: 767,
      }),
      acquire: () => true,
      release: () => {},
      onOrder: (value) => updates.push(value),
      send: async (path, body) => {
        calls.push({ path, body });
        return path === "orders"
          ? { order: quote, providerOrderId }
          : { order: { ...quote, status: "captured" } };
      },
    });
    assert.equal(flow.click(), true);
    if (!enabled || method !== "sdk") {
      await assert.rejects(flow.create(method), /Kartična dopuna trenutno nije dostupna/);
      assert.deepEqual(calls, []);
      continue;
    }
    assert.equal(await flow.create(method), providerOrderId);
    await Promise.all([flow.approve(providerOrderId), flow.approve(providerOrderId)]);
    assert.deepEqual(calls, [
      {
        path: "orders",
        body: { kind: "quote", quoteId: "top-up-quote", requestId: "stable-key", flow: "sdk" },
      },
      { path: "orders/internal-id/capture", body: {} },
    ]);
    assert.equal(updates.at(-1)?.status, "captured");
  }
});
test("an accepted quote binds SDK checkout to its server identity and price for creation, retry and capture", async () => {
  const quote: CardOrder = {
    ...order,
    kind: "quote",
    quoteId: "offer",
    businessId: null,
    amountMinor: 2561,
  };
  assert.equal(canOfferPayPalCard(null, true, "quote"), true);
  assert.equal(canOfferPayPalCard({ ...quote, quoteId: null }, true, "quote"), false);
  for (const response of [quote, { ...quote, quoteId: "other" }, { ...quote, amountMinor: 511 }]) {
    const calls: { path: string; body: unknown }[] = [];
    const saved: CardOrder[] = [];
    const flow = createPayPalCardFlow({
      input: () => ({ requestId: "retry", quoteId: "offer", amountMinor: 2561 }),
      acquire: () => true,
      release: () => {},
      onOrder: (value) => saved.push(value),
      send: async (path, body) => {
        calls.push({ path, body });
        return path === "orders"
          ? { order: response, providerOrderId }
          : { order: { ...quote, status: "captured" } };
      },
    });
    assert.equal(flow.click(), true);
    if (response === quote) {
      await Promise.all([flow.create(), flow.create()]);
      await flow.approve(providerOrderId);
      await flow.approve(providerOrderId);
      assert.equal(calls.length, 2);
      assert.equal(saved.at(-1)?.status, "captured");
    } else {
      await assert.rejects(flow.create());
      await assert.rejects(flow.approve(providerOrderId));
      assert.equal(saved.length, 0);
      assert.equal(calls.length, 1);
    }
    assert.deepEqual(calls[0], {
      path: "orders",
      body: { kind: "quote", quoteId: "offer", requestId: "retry", flow: "sdk" },
    });
  }
});
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
test("duplicate SDK approval waits for the same verified capture and rejects another provider ID", async () => {
  const capture = Promise.withResolvers<{ order: CardOrder }>();
  const t = setup(async (path) =>
    path === "orders" ? { order, providerOrderId } : capture.promise,
  );
  assert.equal(t.flow.click(), true);
  await t.flow.create();

  const first = t.flow.approve(providerOrderId);
  const duplicate = t.flow.approve(providerOrderId);
  let confirmed = false;
  void duplicate.then(() => {
    confirmed = true;
  });
  await assert.rejects(t.flow.approve("OTHERORDER12345"), /ne odgovara/);
  assert.equal(duplicate, first);
  assert.equal(confirmed, false);
  assert.equal(t.updates.at(-1)?.status, "created");
  assert.equal(t.locks(), 1);

  capture.resolve({ order: { ...order, status: "captured" } });
  await Promise.all([first, duplicate]);
  assert.equal(confirmed, true);
  assert.equal(t.flow.approve(providerOrderId), first);
  assert.equal(t.updates.at(-1)?.status, "captured");
  assert.equal(t.calls.filter((call) => call.path.endsWith("/capture")).length, 1);
  assert.equal(t.locks(), 0);
});
test("repeating an approval retains its failed or pending outcome without capturing again", async () => {
  for (const outcome of ["failed", "pending"] as const) {
    const capture = Promise.withResolvers<{ order: CardOrder; pending?: boolean }>();
    const t = setup(async (path) =>
      path === "orders" ? { order, providerOrderId } : capture.promise,
    );
    assert.equal(t.flow.click(), true);
    await t.flow.create();
    const original = t.flow.approve(providerOrderId);
    assert.equal(t.flow.approve(providerOrderId), original);
    const expected = outcome === "failed" ? /fixture capture unavailable/ : /još nije potvrđena/;
    const rejected = assert.rejects(original, expected);
    if (outcome === "failed") capture.reject(new Error("fixture capture unavailable"));
    else capture.resolve({ order: { ...order, status: "provider_created" }, pending: true });
    await rejected;

    const repeated = t.flow.approve(providerOrderId);
    assert.equal(repeated, original);
    await assert.rejects(repeated, expected);
    assert.equal(t.calls.filter((call) => call.path.endsWith("/capture")).length, 1);
    assert.equal(
      t.updates.some((value) => value.status === "captured"),
      false,
    );
    assert.equal(t.locks(), 0);
  }
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
test("a capture with a mismatched purchase cannot display a completed payment", async () => {
  const t = setup(async (path) =>
    path === "orders"
      ? { order, providerOrderId }
      : { order: { ...order, status: "captured", amountMinor: 1100 } },
  );
  assert.equal(t.flow.click(), true);
  await t.flow.create();
  await assert.rejects(t.flow.approve(providerOrderId));
  assert.equal(
    t.updates.some((value) => value.status === "captured"),
    false,
  );
  assert.equal(t.locks(), 0);
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

test("advanced approval creates a card-fields order and only captures the returned provider ID", async () => {
  const advanced: CardOrder = { ...order, flow: "card-fields", status: "provider_created" };
  const t = setup(async (path) =>
    path === "orders"
      ? { order: advanced, providerOrderId }
      : { order: { ...advanced, status: "captured" } },
  );
  assert.equal(t.flow.click(), true);
  assert.equal(await t.flow.create("card-fields"), providerOrderId);
  assert.equal((t.calls[0]?.body as { flow: string } | undefined)?.flow, "card-fields");
  await assert.rejects(t.flow.approve("WRONGORDER12345"));
  await t.flow.approve(providerOrderId);
  await t.flow.approve(providerOrderId);
  assert.equal(t.calls.filter((c) => c.path.endsWith("/capture")).length, 1);
  for (const saved of [
    advanced,
    { ...order, flow: "sdk" as const },
    { ...advanced, flow: "guest" as const },
  ]) {
    const previous = setup(undefined, saved);
    assert.equal(canOfferPayPalCard(saved, false, "promotion"), true);
    previous.flow.click();
    await assert.rejects(
      previous.flow.create(saved.flow === "card-fields" ? "sdk" : "card-fields"),
    );
    assert.equal(previous.calls.length, 0);
  }
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
  const capture = Promise.withResolvers<{ order: CardOrder }>();
  const nextOrder = { ...order, id: "new-order", requestId: "new-request" };
  const nextProviderId = "LATERORDER123456";
  let created = 0;
  const t = setup(async (path) => {
    if (path === "orders")
      return created++ === 0
        ? { order, providerOrderId }
        : { order: nextOrder, providerOrderId: nextProviderId };
    return path === "orders/internal-id/capture"
      ? capture.promise
      : { order: { ...nextOrder, status: "captured" } };
  });
  t.flow.click();
  await t.flow.create();
  const first = t.flow.approve(providerOrderId);
  const duplicate = t.flow.approve(providerOrderId);
  assert.equal(duplicate, first);
  const stale = assert.rejects(first);
  t.flow.cancel();
  t.flow.click();
  await t.flow.create();
  capture.resolve({ order: { ...order, status: "captured" } });
  await stale;
  await assert.rejects(t.flow.approve(providerOrderId), /ne odgovara/);
  assert.equal(t.locks(), 1);
  assert.equal(
    t.updates.some((o) => o.status === "captured"),
    false,
  );
  await t.flow.approve(nextProviderId);
  assert.equal(t.updates.at(-1)?.id, nextOrder.id);
  assert.equal(t.updates.at(-1)?.status, "captured");
  assert.equal(t.locks(), 0);
  t.flow.dispose();
});

test("a capture response after disposal rejects both approvals without updating the order", async () => {
  const capture = Promise.withResolvers<{ order: CardOrder }>();
  const t = setup(async (path) =>
    path === "orders" ? { order, providerOrderId } : capture.promise,
  );
  assert.equal(t.flow.click(), true);
  await t.flow.create();
  const first = t.flow.approve(providerOrderId);
  assert.equal(t.flow.approve(providerOrderId), first);
  const stale = assert.rejects(first, { name: "AbortError" });
  t.flow.dispose();
  capture.resolve({ order: { ...order, status: "captured" } });
  await stale;
  await assert.rejects(t.flow.approve(providerOrderId), { name: "AbortError" });
  assert.equal(t.updates.at(-1)?.status, "created");
  assert.equal(t.calls.filter((call) => call.path.endsWith("/capture")).length, 1);
  assert.equal(t.locks(), 0);
});
