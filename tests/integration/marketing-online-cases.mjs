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
  await t.test(
    "photo and video quotes settle once against production receipts, without listing or package rights",
    async () => {
      const business = await makeBusiness();
      const priorBalance = await balance();
      await assert.rejects(
        command(other, {
          id: randomUUID(),
          action: "request",
          kind: "photo",
          quantity: 1,
          businessId: business,
        }),
        (e) => e.code === "BUSINESS_CHANGED",
      );
      await assert.rejects(
        command(user, {
          id: randomUUID(),
          action: "request",
          kind: "photo",
          quantity: 3,
          businessId: business,
        }),
        (e) => e.code === "INVALID_OFFER",
      );
      const photo = await quote("photo", 1, 20001, business);
      await assert.rejects(store.create(other, input(photo)), /QUOTE_NOT_PAYABLE/);
      const first = await attach(await store.create(user, input(photo)));
      const [paid, replay] = await Promise.all([capture(first), capture(first)]);
      assert.equal(replay.captureId, paid.captureId);
      const readReceipts = async (id) =>
        (
          await pool.query(
            "SELECT id,kind,source,external_reference,allocation_status,package_id,period,gross_minor,refunded_minor,version,development_minor FROM billing_receipt WHERE production_order_id=$1",
            [id],
          )
        ).rows;
      const [receipt] = await readReceipts(photo);
      assert.equal(receipt.kind, "photo_video");
      assert.equal(receipt.source, "paypal");
      assert.equal(receipt.external_reference, paid.captureId);
      assert.equal(receipt.gross_minor, 20001);
      assert.equal(receipt.refunded_minor, 0);
      assert.equal(receipt.development_minor, null);
      assert.equal(receipt.allocation_status, "not_applicable");
      assert.equal(receipt.package_id, null);
      assert.equal(receipt.period, null);
      assert.equal((await state(photo)).starts_at, null);
      assert.equal((await state(photo)).ends_at, null);
      const partial = {
        captureId: paid.captureId,
        refundedMinor: Math.floor(paid.amountMinor / 2),
      };
      await Promise.all([
        store.reconcileRefund(paid.id, partial),
        store.reconcileRefund(paid.id, partial),
      ]);
      assert.equal((await readReceipts(photo))[0].version, 2);
      assert.equal(
        (await readReceipts(photo))[0].refunded_minor,
        Math.round((partial.refundedMinor * 20001) / paid.amountMinor),
      );
      await store.reconcileRefund(paid.id, {
        captureId: paid.captureId,
        refundedMinor: paid.amountMinor,
      });
      assert.equal((await readReceipts(photo))[0].refunded_minor, 20001);
      assert.equal(
        (
          await pool.query("SELECT count(*) AS n FROM billing_receipt_event WHERE receipt_id=$1", [
            receipt.id,
          ])
        ).rows[0].n,
        "3",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) AS n FROM billing_development_ledger WHERE receipt_id=$1",
            [receipt.id],
          )
        ).rows[0].n,
        "0",
      );
      const video = await quote("video", 1, 35000, business);
      const testPayment = await capture(
        await attach(await store.create(user, input(video, "sandbox"))),
      );
      assert.equal(testPayment.status, "captured");
      assert.deepEqual(await readReceipts(video), []);
      await Promise.all([bank(video, 35000), bank(video, 35000)]);
      const bankReceipts = await readReceipts(video);
      assert.equal(bankReceipts.length, 1);
      assert.equal(bankReceipts[0].source, "bank");
      assert.equal(bankReceipts[0].external_reference, `FIXTURE-${video}`.toUpperCase());
      assert.equal((await state(video)).ends_at, null);
      const correctedFirst = await quote("photo_video", 1, 25000, business);
      const attachedFirst = await attach(await store.create(user, input(correctedFirst)));
      const captureEvidence = {
        providerOrderId: attachedFirst.providerOrderId,
        captureId: `CAPTURE${attachedFirst.providerOrderId}`,
        merchantId: attachedFirst.merchantId,
        amountMinor: attachedFirst.amountMinor,
        currency: "EUR",
        completedAt: new Date().toISOString(),
      };
      await store.settleRefundedCapture(attachedFirst.id, captureEvidence, { refundedMinor: null });
      assert.ok((await state(correctedFirst)).revoked_at);
      assert.equal((await readReceipts(correctedFirst))[0].refunded_minor, 0);
      assert.equal((await store.read(user, attachedFirst.id)).refundTotalUnknown, true);
      await store.reconcileRefund(attachedFirst.id, {
        captureId: captureEvidence.captureId,
        refundedMinor: attachedFirst.amountMinor,
      });
      assert.equal((await readReceipts(correctedFirst))[0].refunded_minor, 25000);
      const combined = randomUUID();
      await command(user, {
        id: combined,
        action: "request",
        kind: "photo_video",
        quantity: 1,
        businessId: business,
      });
      await assert.rejects(
        command(owner, {
          id: combined,
          action: "quote",
          amountMinor: 35000,
          creditPrice: 4,
          instructions: "Ponuda",
        }),
        (e) => e.code === "OFFER_CHANGED",
      );
      assert.equal(await balance(), priorBalance);
    },
  );
  await t.test(
    "production can precede publication and preserves an existing manual receipt on capture",
    async () => {
      const business = await makeBusiness();
      await pool.query(
        "UPDATE directory_business SET status='draft',published_at=NULL WHERE id=$1",
        [business],
      );
      const choices = await marketing.read(headers(user), "ads", 0);
      assert.equal(
        choices.businesses.some((item) => item.id === business),
        false,
      );
      assert.equal(
        choices.productionBusinesses.some((item) => item.id === business),
        true,
      );
      for (const samePrice of [true, false]) {
        const id = await quote("photo_video", 1, 14900, business);
        const attached = await attach(await store.create(user, input(id)));
        const ref = `CAPTURE${attached.providerOrderId}`,
          receiptId = randomUUID();
        await pool.query(
          `INSERT INTO billing_receipt(id,kind,business_id,business_title,source,external_reference,received_at,gross_minor,allocation_status,created_by_user_id)
        SELECT $1,'photo_video',id,title,'paypal',$3,now(),$4,'not_applicable',$5 FROM directory_business WHERE id=$2`,
          [receiptId, business, ref, samePrice ? 14900 : 10000, owner.userId],
        );
        const paid = await capture(attached);
        assert.equal(paid.status, "captured");
        const stored = (
          await pool.query(
            "SELECT production_order_id,version FROM billing_receipt WHERE external_reference=$1 AND source='paypal'",
            [ref],
          )
        ).rows;
        assert.equal(stored.length, 1);
        assert.equal(stored[0].production_order_id, samePrice ? id : null);
        assert.equal(stored[0].version, samePrice ? 2 : 1);
        const offers = await marketing.read(headers(owner), "admin", 0);
        assert.equal(offers.orders.find((o) => o.id === id).productionReceiptConflict, !samePrice);
      }
    },
  );
}
