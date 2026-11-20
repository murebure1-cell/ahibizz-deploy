import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readActiveBanner } from "../../src/server/marketing/read.ts";
import { createMarketingService } from "../../src/server/marketing/service.ts";

export async function verifyMarketingOnlineQuotes(
  t,
  { pool, store, user, owner, other, makeBusiness, attach, capture },
) {
  const actors = new Map([user, owner, other].map((actor) => [actor.token, actor]));
  const auth = {
    api: {
      async getSession({ headers }) {
        const actor = actors.get(headers.get("test-session"));
        return actor ? { user: { id: actor.userId }, session: actor } : null;
      },
    },
  };
  const marketing = createMarketingService(auth, pool);
  const headers = (actor) => new Headers({ "test-session": actor.token });
  const command = (actor, input) => marketing.command(headers(actor), input);
  const balance = async () => (await marketing.read(headers(user), "credits", 0)).balance;
  const quote = async (kind, quantity, amountMinor, businessId) => {
    const id = randomUUID();
    await command(user, {
      action: "request",
      id,
      kind,
      quantity,
      ...(businessId ? { businessId } : {}),
    });
    await command(owner, { action: "quote", id, amountMinor, instructions: "Probna ponuda" });
    return id;
  };
  const input = (quoteId, environment = "live") => ({
    kind: "quote",
    requestId: randomUUID(),
    quoteId,
    merchantId: "FIXTURE_MERCHANT",
    environment,
    offerVersion: "marketing-quote-v1:sdk",
  });
  const bank = (id, amountMinor) =>
    command(owner, {
      action: "confirm",
      id,
      amountMinor,
      reference: `FIXTURE-${id}`,
    });
  const state = async (id) =>
    (
      await pool.query(
        "SELECT status,online_checkout_id,bank_reference,revoked_at,starts_at,ends_at FROM marketing_order WHERE id=$1",
        [id],
      )
    ).rows[0];

  await t.test(
    "credit quote locks its price, buyer and flow, grants once and reverses on refund",
    async () => {
      const baseline = await balance();
      const id = await quote("credits", 30, 1000);
      const terms = input(id);
      await assert.rejects(store.create(other, terms), /QUOTE_NOT_PAYABLE/);
      await assert.rejects(
        store.create(user, { ...terms, amountMinor: 1 }),
        /INVALID_CHECKOUT_INPUT/,
      );
      const [first, repeated] = await Promise.all([
        store.create(user, terms),
        store.create(user, input(id)),
      ]);
      assert.equal(first.id, repeated.id);
      assert.equal(first.quoteId, id);
      assert.equal(first.originalBamMinor, 1000);
      assert.equal(first.amountMinor, 511);
      assert.equal(first.currency, "EUR");
      await assert.rejects(
        store.create(user, {
          ...input(id),
          offerVersion: "marketing-quote-v1:card-fields",
        }),
        /CHECKOUT_FLOW_MISMATCH/,
      );
      const attached = await attach(first);
      await assert.rejects(bank(id, 1000), (error) => error.code === "QUOTE_PAYMENT_PENDING");
      await assert.rejects(
        command(user, { id, action: "close" }),
        (error) => error.code === "QUOTE_PAYMENT_PENDING",
      );
      assert.equal(await balance(), baseline);
      const paid = await capture(attached);
      assert.equal(paid.status, "captured");
      const replays = await Promise.all([capture(attached), capture(attached)]);
      for (const replay of replays) assert.equal(replay.captureId, paid.captureId);
      assert.equal((await state(id)).online_checkout_id, paid.id);
      assert.equal((await state(id)).bank_reference, null);
      assert.equal(await balance(), baseline + 30);
      await assert.rejects(store.create(user, input(id)), /QUOTE_NOT_PAYABLE/);
      const refund = { captureId: paid.captureId, refundedMinor: paid.amountMinor };
      assert.equal((await store.reconcileRefund(paid.id, refund)).status, "refunded");
      await store.reconcileRefund(paid.id, refund);
      assert.ok((await state(id)).revoked_at);
      assert.equal(await balance(), baseline);
      await capture(attached);
      assert.equal(await balance(), baseline);
    },
  );

  await t.test(
    "sandbox capture leaves credits and quote untouched and permits independent bank settlement",
    async () => {
      const baseline = await balance();
      const id = await quote("credits", 15, 1500);
      const paid = await capture(await attach(await store.create(user, input(id, "sandbox"))));
      assert.equal(paid.status, "captured");
      assert.equal(await balance(), baseline);
      assert.equal((await state(id)).status, "quoted");
      assert.equal((await state(id)).online_checkout_id, null);
      await bank(id, 1500);
      await assert.rejects(store.create(user, input(id)), /QUOTE_NOT_PAYABLE/);
      await store.reconcileRefund(paid.id, {
        captureId: paid.captureId,
        refundedMinor: paid.amountMinor,
      });
      assert.equal(await balance(), baseline + 15);
      assert.equal((await state(id)).revoked_at, null);
    },
  );

  await t.test(
    "concurrent checkouts on distinct placement quotes keep independent rights and durations",
    async () => {
      const business = await makeBusiness();
      const banner = await quote("banner", 7, 1800, business);
      const featured = await quote("featured", 2, 600, business);
      const inputs = [input(banner), input(featured)];
      const orders = await Promise.all(inputs.map((args) => store.create(user, args)));
      assert.notEqual(orders[0].id, orders[1].id);
      await assert.rejects(
        store.create(user, { ...inputs[0], quoteId: featured }),
        /COMMAND_CONFLICT/,
      );
      const attached = await Promise.all(orders.map(attach));
      const paid = await Promise.all(attached.map((order) => capture(order)));
      assert.ok(paid.every((p) => p.status === "captured"));
      for (const [index, days] of [7, 2].entries()) {
        const offer = await state(inputs[index].quoteId);
        assert.equal(offer.online_checkout_id, paid[index].id);
        assert.equal(offer.ends_at - offer.starts_at, days * 86400000);
      }
      assert.equal((await readActiveBanner(pool)).id, business);
      const refund = { captureId: paid[0].captureId, refundedMinor: paid[0].amountMinor };
      await store.reconcileRefund(paid[0].id, refund);
      assert.equal(await readActiveBanner(pool), null);
      assert.ok((await state(banner)).revoked_at);
      assert.equal((await state(featured)).revoked_at, null);
    },
  );
}
