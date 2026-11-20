import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPublicDirectoryService } from "../../src/server/directory/read-service.ts";
import { createMarketingService } from "../../src/server/marketing/service.ts";

export async function verifyWalletCategoryPromotion(
  t,
  { pool, store, user, owner, other, makeBusiness, visible, category2 },
) {
  const users = new Map([user, owner, other].map((a) => [a.token, a]));
  const auth = {
    api: {
      async getSession({ headers }) {
        const actor = users.get(headers.get("test-session"));
        return actor ? { user: { id: actor.userId }, session: actor } : null;
      },
    },
  };
  const marketing = createMarketingService(auth, pool);
  const headers = (actor) =>
    new Headers({ "test-session": actor.token, "X-AhiBizz-Account-ID": actor.userId });
  const command = (actor, input) => marketing.command(headers(actor), input);
  const offer = (businessId) => ({
    action: "promoteCategory",
    id: randomUUID(),
    businessId,
    expectedCreditMinor: 1000,
  });
  const cash = (businessId) =>
    store.create(user, {
      requestId: randomUUID(),
      kind: "promotion",
      businessId,
      amountMinor: 511,
      environment: "live",
      merchantId: "FIXTURE_MERCHANT",
      offerVersion: "wallet-conflict",
    });
  const overview = () => marketing.read(headers(user), "ads", 0);

  await t.test("wallet category price, ownership, idempotency and visible delivery", async () => {
    const current = await marketing.read(headers(owner), "credits", 0);
    await command(owner, {
      action: "setCreditRate",
      id: randomUUID(),
      unitBamMinor: 100,
      expectedUnitBamMinor: current.creditUnitBamMinor,
    });
    const topUp = randomUUID();
    await command(user, { action: "request", id: topUp, kind: "credits", quantity: 95 });
    await command(owner, {
      action: "quote",
      id: topUp,
      amountMinor: 9500,
      instructions: "Probna ponuda",
    });
    await command(owner, {
      action: "confirm",
      id: topUp,
      amountMinor: 9500,
      reference: `FIXTURE-${topUp}`,
    });
    const before = (await overview()).balance;
    const operation = offer(await makeBusiness());
    await assert.rejects(command(other, operation), (e) => e.code === "BUSINESS_NOT_ELIGIBLE");
    await assert.rejects(
      command(user, { ...operation, expectedCreditMinor: 999 }),
      (e) => e.code === "WALLET_PAYMENT_CHANGED",
    );
    const delivered = await Promise.all([command(user, operation), command(user, operation)]);
    assert.deepEqual(delivered[0], delivered[1]);
    assert.equal(Math.round((await overview()).balance * 100), Math.round(before * 100) - 1000);
    assert.equal(
      (await overview()).promotions.some((p) => p.id === operation.businessId),
      true,
    );
    assert.equal(await visible(operation.businessId), true);
    const publicDirectory = createPublicDirectoryService({ database: pool });
    const featured = await publicDirectory.listPublic({}, "category");
    assert(featured.items.some((b) => b.id === operation.businessId && b.featured));
    await assert.rejects(
      command(user, offer(operation.businessId)),
      (e) => e.code === "PROMOTION_ALREADY_RESERVED",
    );
    await assert.rejects(
      cash(operation.businessId),
      (e) => e.code === "PROMOTION_ALREADY_RESERVED",
    );
    await assert.rejects(
      command(user, { ...operation, businessId: await makeBusiness() }),
      (e) => e.code === "WALLET_PAYMENT_CHANGED",
    );
    const original = (
      await pool.query("SELECT category_id FROM directory_business WHERE id=$1", [
        operation.businessId,
      ])
    ).rows[0].category_id;
    for (const cat of [category2, original]) {
      await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
        operation.businessId,
        cat,
      ]);
      assert.equal(await visible(operation.businessId), false);
    }
    assert.equal(
      (await overview()).promotions.some((p) => p.id === operation.businessId),
      false,
    );
  });
  await t.test(
    "a wallet buy and a live checkout cannot reserve the same category placement twice",
    async () => {
      const businessId = await makeBusiness();
      const before = (await overview()).balance;
      const outcomes = await Promise.allSettled([
        command(user, offer(businessId)),
        cash(businessId),
      ]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      assert.equal(
        outcomes.find((o) => o.status === "rejected").reason.code,
        "PROMOTION_ALREADY_RESERVED",
      );
      const walletWon = outcomes[0].status === "fulfilled";
      assert.equal(await visible(businessId), walletWon);
      assert.equal(
        Math.round((await overview()).balance * 100),
        Math.round(before * 100) - (walletWon ? 1000 : 0),
      );
    },
  );
}
