import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { accountTransaction } from "../../src/server/auth/accounts.ts";
import { debitWallet } from "../../src/server/wallet/service.ts";

export async function verifyWallet(
  t,
  {
    marketing,
    command,
    headers,
    user,
    owner,
    other,
    makeBusiness,
    quote,
    input,
    attach,
    capture,
    store,
    pool,
  },
) {
  const data = () => marketing.read(headers(user), "credits", 0);
  await t.test(
    "self-service top-up and a quoted banner retain their agreed prices, fulfillment and refund history",
    async () => {
      const start = await data();
      const rate = {
        action: "setCreditRate",
        id: randomUUID(),
        unitBamMinor: 100,
        expectedUnitBamMinor: start.creditUnitBamMinor,
      };
      await assert.rejects(command(user, rate), (e) => e.status === 403);
      assert.equal(start.creditUnitBamMinor, 10);
      for (const [quantity, expectedAmountMinor] of [
        [60, 1500],
        [130, 2000],
        [260, 3000],
        [675, 6000],
        [1400, 11000],
        [3000, 21000],
      ]) {
        const next = await command(other, {
          action: "topUp",
          id: randomUUID(),
          quantity,
          expectedAmountMinor,
        });
        const record = (await marketing.read(headers(other), "credits", 0)).orders.find(
          (o) => o.id === next.id,
        );
        assert.equal(record.status, "quoted");
        assert.equal(record.amountMinor, expectedAmountMinor);
        assert.equal(record.quantity, quantity);
        await command(other, { action: "close", id: next.id });
      }
      const request = {
        action: "topUp",
        id: randomUUID(),
        quantity: 60,
        expectedAmountMinor: 1500,
      };
      await assert.rejects(
        command(user, { ...request, expectedAmountMinor: 99 }),
        (e) => e.code === "CREDIT_BUNDLE_CHANGED",
      );
      await assert.rejects(
        command(user, { ...request, quantity: 61 }),
        (e) => e.code === "INVALID_CREDIT_BUNDLE",
      );
      const alias = { ...request, id: randomUUID() };
      const results = await Promise.all([command(user, request), command(user, alias)]);
      assert.equal(results[0].id, results[1].id);
      const id = results[0].id;
      await assert.rejects(
        command(user, { ...request, id: randomUUID(), quantity: 130, expectedAmountMinor: 2000 }),
        (e) => e.code === "OPEN_OFFER",
      );
      const written = (await data()).orders.find((o) => o.id === id);
      assert.equal(written.status, "quoted");
      assert.equal(written.amountMinor, 1500);
      assert.equal((await data()).balance, start.balance);
      const paid = await capture(await attach(await store.create(user, input(id))));
      assert.equal(paid.status, "captured");
      await Promise.all([capture(paid), command(user, alias)]);
      assert.equal((await data()).balance, start.balance + 60);
      await Promise.all([command(owner, rate), command(owner, rate)]);
      assert.equal((await data()).movements.filter((m) => m.id === `topup:${id}`).length, 1);
      const business = await makeBusiness(),
        banner = await quote("banner", 1, 251, business);
      for (const kind of ["photo", "video", "photo_video"]) {
        const excluded = await quote(kind, 1, 251, business);
        const listed = (await marketing.read(headers(user), "ads", 0)).orders.find(
          (o) => o.id === excluded,
        );
        assert.equal(listed.creditPrice, null);
        await assert.rejects(
          command(user, { action: "useCredits", id: excluded }),
          (e) => e.code === "OFFER_FORBIDDEN",
        );
      }
      const changed = { ...rate, id: randomUUID(), expectedUnitBamMinor: 100, unitBamMinor: 50 };
      await command(owner, changed);
      const details = await marketing.read(headers(user), "ads", 0);
      assert.equal(details.orders.find((o) => o.id === banner).creditPrice, 2.51);
      await assert.rejects(
        command(other, { action: "useCredits", id: banner }),
        (e) => e.status === 404,
      );
      const settle = { action: "useCredits", id: banner };
      await Promise.all([command(user, settle), command(user, settle)]);
      const after = await data();
      assert.equal(Math.round(after.balance * 100), Math.round(start.balance * 100) + 5749);
      assert.equal(after.movements.filter((m) => m.id === `debit:${banner}`).length, 1);
      assert.equal(after.movements.find((m) => m.id === `debit:${banner}`).amount, -2.51);
      await assert.rejects(
        pool.query("DELETE FROM ahi_wallet_debit WHERE purchase_id=$1", [banner]),
        (error) => error.code === "23514",
      );

      const partial = {
        captureId: paid.captureId,
        refundedMinor: Math.floor(paid.amountMinor / 2),
      };
      await Promise.all([
        store.reconcileRefund(paid.id, partial),
        store.reconcileRefund(paid.id, partial),
      ]);
      const adjusted = Math.round((6000 * partial.refundedMinor) / paid.amountMinor) / 100;
      assert.equal((await data()).balance, Math.round((after.balance - adjusted) * 100) / 100);
      assert.equal(
        (await data()).movements.find((m) => m.id === `reversal:${id}`).amount,
        -adjusted,
      );

      // A simultaneous provider reversal and spend have two valid serial outcomes. Replay remains deterministic.
      const race = {
        accountId: user.userId,
        purchaseId: randomUUID(),
        kind: "package",
        creditMinor: Math.round((await data()).balance * 100),
      };
      const [attempt, correction] = await Promise.allSettled([
        accountTransaction(pool, (client) => debitWallet(client, race)),
        store.reconcileRefund(paid.id, {
          captureId: paid.captureId,
          refundedMinor: paid.amountMinor,
        }),
      ]);
      assert.equal(correction.status, "fulfilled");
      if (attempt.status === "fulfilled") {
        assert.equal(attempt.value, true);
        assert.equal(await accountTransaction(pool, (client) => debitWallet(client, race)), false);
        assert.equal((await data()).balance, 0);
      } else {
        assert.equal(attempt.reason.code, "INSUFFICIENT_CREDITS");
        assert.equal(
          (await data()).balance,
          Math.max(0, Math.round((start.balance - 2.51) * 100) / 100),
        );
      }
      assert.equal((await data()).movements.filter((m) => m.id === `reversal:${id}`).length, 1);
      const sum = await pool.query(
        "SELECT SUM(amount_minor)::bigint minor FROM ahi_credit_movements WHERE account_id=$1",
        [user.userId],
      );
      assert.equal((await data()).balance, Math.max(0, Number(sum.rows[0].minor) / 100));
    },
  );
}
