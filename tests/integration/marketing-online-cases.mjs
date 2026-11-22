import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readActiveBanner } from "../../src/server/marketing/read.ts";
import { createMarketingService } from "../../src/server/marketing/service.ts";
import { createCheckoutStore } from "../../src/server/paypal/store.ts";
import { verifyWallet } from "./wallet-core-cases.mjs";

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
    offerVersion: "marketing-quote-v1",
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
      for (const flow of ["sdk", "guest", "card-fields"]) {
        const attempt = { ...input(id), offerVersion: `marketing-quote-v1:${flow}` };
        await assert.rejects(store.create(user, attempt), /CREDIT_TOP_UP_PAYPAL_REQUIRED/);
        await assert.rejects(store.create(other, attempt), /QUOTE_NOT_PAYABLE/);
      }
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
      assert.equal(first.quoteKind, "credits");
      assert.equal(first.originalBamMinor, 1000);
      assert.equal(first.amountMinor, 511);
      assert.equal(first.currency, "EUR");
      await assert.rejects(
        store.create(user, {
          ...input(id),
          offerVersion: "marketing-quote-v1:card-fields",
        }),
        /CREDIT_TOP_UP_PAYPAL_REQUIRED/,
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
    "verified embedded card payment credits the exact catalogue bundle once",
    async () => {
      const cardStore = createCheckoutStore(pool, { creditCardTopUps: true });
      const baseline = await balance();
      const terms = { action: "topUp", quantity: 60, expectedAmountMinor: 1500 };
      const { id } = await command(user, { ...terms, id: randomUUID() });
      const cardInput = { ...input(id), offerVersion: "marketing-quote-v1:sdk" };
      await assert.rejects(cardStore.create(other, cardInput), /QUOTE_NOT_PAYABLE/);
      const first = await cardStore.create(user, cardInput);
      assert.equal(first.originalBamMinor, 1500);
      assert.equal(first.amountMinor, 767);
      assert.equal((await cardStore.create(user, cardInput)).id, first.id);
      await assert.rejects(cardStore.create(user, input(id)), /CHECKOUT_FLOW_MISMATCH/);
      const saved = await cardStore.attachProvider(first.id, {
        providerOrderId: "FIXTURECARDTOPUP20261122",
        approvalUrl: null,
      });
      await cardStore.prepareCapture(user, saved.id);
      assert.equal(saved.approvalUrl, null);
      assert.equal(await balance(), baseline);
      await assert.rejects(bank(id, 1500), (error) => error.code === "QUOTE_PAYMENT_PENDING");
      const [paid, replay] = await Promise.all([capture(saved), capture(saved)]);
      assert.equal(paid.status, "captured");
      assert.equal(replay.captureId, paid.captureId);
      assert.equal((await state(id)).online_checkout_id, paid.id);
      assert.equal(await balance(), baseline + 60);
      await cardStore.reconcileRefund(paid.id, {
        captureId: paid.captureId,
        refundedMinor: paid.amountMinor,
      });
      assert.equal(await balance(), baseline);
    },
  );

  await t.test(
    "live pilot uses persisted platform-owner authority for marketing and payment creation",
    async () => {
      const env = process.env;
      process.env = {
        ...env,
        PAYPAL_CHECKOUT_ENVIRONMENT: "live",
        PAYPAL_LIVE_CLIENT_ID: "fixture",
        PAYPAL_LIVE_CLIENT_SECRET: "fixture",
        PAYPAL_LIVE_MERCHANT_ID: "FIXTURE_MERCHANT",
        PAYPAL_LIVE_WEBHOOK_ID: "fixture",
        PAYPAL_CHECKOUT_PUBLIC_ORIGIN: "https://checkout.invalid",
        PAYPAL_CHECKOUT_ENABLED: "true",
        PAYPAL_CHECKOUT_EUR_PRICE_APPROVED: "true",
        PAYPAL_CHECKOUT_FULFILLMENT_READY: "true",
        PAYPAL_CREDIT_CARD_TOPUPS_ENABLED: "false",
        PAYPAL_CREDIT_CARD_TOPUPS_PILOT_OWNER: "true",
      };
      try {
        const pilot = createCheckoutStore(pool, { creditCardTopUpsPilotOwner: true });
        assert.equal((await marketing.read(headers(user), "credits", 0)).creditCardTopUps, false);
        assert.equal((await marketing.read(headers(owner), "credits", 0)).creditCardTopUps, true);
        const terms = { action: "topUp", quantity: 60, expectedAmountMinor: 1500 };
        const memberTopUp = await command(user, { ...terms, id: randomUUID() });
        const ownerTopUp = await command(owner, { ...terms, id: randomUUID() });
        const cardTerms = (id, environment) => ({
          ...input(id, environment),
          offerVersion: "marketing-quote-v1:sdk",
        });
        await assert.rejects(
          pilot.create({ ...user, role: "owner" }, cardTerms(memberTopUp.id, "live")),
          /CREDIT_TOP_UP_PAYPAL_REQUIRED/,
        );
        await assert.rejects(
          pilot.create(owner, cardTerms(ownerTopUp.id, "sandbox")),
          /CREDIT_TOP_UP_PAYPAL_REQUIRED/,
        );
        const order = await pilot.create(owner, cardTerms(ownerTopUp.id, "live"));
        assert.equal(order.userId, owner.userId);
        assert.equal(order.quoteId, ownerTopUp.id);
        await pilot.attachProvider(order.id, {
          providerOrderId: "FIXTUREOWNERPILOT",
          approvalUrl: null,
        });
        await pilot.cancelPromotion(owner, order.id, async () => true);
        await command(owner, { action: "close", id: ownerTopUp.id });
        await command(user, { action: "close", id: memberTopUp.id });
      } finally {
        process.env = env;
      }
    },
  );

  await t.test(
    "unpaid or definitively declined embedded top-ups release only their linked quote",
    async () => {
      const cardStore = createCheckoutStore(pool, { creditCardTopUps: true });
      const baseline = await balance();
      const id = await quote("credits", 30, 1000);
      const createCardOrder = async (providerOrderId) => {
        const pending = await cardStore.create(user, {
          ...input(id),
          offerVersion: "marketing-quote-v1:sdk",
        });
        return cardStore.attachProvider(pending.id, { providerOrderId, approvalUrl: null });
      };
      const first = await createCardOrder("FIXTURECANCELTOPUP1");
      await assert.rejects(
        store.cancelPromotion(other, first.id, async () => assert.fail("Must verify the buyer")),
        /ORDER_NOT_FOUND/,
      );
      await assert.rejects(
        store.cancelPromotion(user, first.id, async () => false),
        /ORDER_CANCELLATION_UNAVAILABLE/,
      );
      await assert.rejects(bank(id, 1000), (error) => error.code === "QUOTE_PAYMENT_PENDING");
      const cancelled = await store.cancelPromotion(user, first.id, async () => true);
      assert.equal(cancelled.status, "cancelled");
      await assert.rejects(store.prepareCapture(user, cancelled.id), /ORDER_NOT_PAYABLE/);

      const second = await createCardOrder("FIXTUREDECLINETOPUP2");
      assert.notEqual(second.id, first.id);
      const proof = {
        captureId: "FIXTUREDECLINEDPAYMENT",
        providerOrderId: second.providerOrderId,
        merchantId: second.merchantId,
        amountMinor: second.amountMinor,
        currency: second.currency,
      };
      await assert.rejects(
        store.closeDeclinedPromotion(second, { ...proof, providerOrderId: first.providerOrderId }),
        /DECLINE_MISMATCH/,
      );
      assert.equal((await store.closeDeclinedPromotion(second, proof)).status, "cancelled");
      assert.equal((await state(id)).online_checkout_id, null);
      assert.equal(await balance(), baseline);
      const third = await createCardOrder("FIXTURERETRYTOPUP3");
      assert.notEqual(third.id, second.id);
      assert.equal(third.quoteId, id);
      await store.cancelPromotion(user, third.id, async () => true);
      await command(user, { id, action: "close" });
    },
  );

  await t.test(
    "a legacy top-up allows verification and capture but cannot reopen a card form",
    async () => {
      const baseline = await balance();
      const id = await quote("credits", 20, 1000);
      const legacy = { ...input(id), offerVersion: "marketing-quote-v1:guest" };
      const providerOrderId = "LEGACYTOPUP1234";
      const orderId = randomUUID();
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "quote",
            null,
            null,
            legacy.merchantId,
            legacy.environment,
            legacy.offerVersion,
            id,
          ]),
        )
        .digest("hex");
      await pool.query(
        `INSERT INTO paypal_checkout_order (
         id,user_id,request_id,fingerprint,environment,kind,quote_id,business_title,
         offer_version,original_bam_minor,amount_minor,merchant_id,status,provider_order_id,
         create_request_id,capture_request_id
       ) VALUES($1,$2,$3,$4,$5,'quote',$6,'20 Ahi Credits',$7,1000,511,$8,
         'provider_created',$9,$10,$11)`,
        [
          orderId,
          user.userId,
          legacy.requestId,
          fingerprint,
          legacy.environment,
          id,
          legacy.offerVersion,
          legacy.merchantId,
          providerOrderId,
          randomUUID(),
          randomUUID(),
        ],
      );
      await assert.rejects(store.create(user, legacy), /CREDIT_TOP_UP_PAYPAL_REQUIRED/);
      await assert.rejects(store.create(user, input(id)), /CHECKOUT_FLOW_MISMATCH/);
      await assert.rejects(
        store.readPendingGuestCard(user, orderId),
        /CREDIT_TOP_UP_PAYPAL_REQUIRED/,
      );
      const saved = await store.read(user, orderId);
      assert.equal(saved.quoteKind, "credits");
      assert.equal(saved.providerOrderId, providerOrderId);
      assert.equal(await store.canCompleteApprovedPayment(user, saved), true);
      await store.prepareCapture(user, orderId);
      const paid = await capture(saved);
      assert.equal(paid.status, "captured");
      assert.equal(await balance(), baseline + 20);
    },
  );

  await t.test("a failed pending refund restores only the original verified top-up", async () => {
    const baseline = await balance();
    const id = await quote("credits", 15, 1000);
    const paid = await capture(await attach(await store.create(user, input(id))));
    assert.equal(await balance(), baseline + 15);
    const command = await store.reserveRefund(owner, paid.id, {
      requestId: randomUUID(),
      amountMinor: 100,
      reason: "failed credit refund fixture",
    });
    const facts = { refundId: `REFUND${command.id}`, amountMinor: 100, captureId: paid.captureId };
    await store.attachRefundResult(command.id, { ...facts, status: "PENDING" });
    assert.equal(await balance(), baseline);
    assert.equal((await capture(paid)).status, "review");
    await store.attachRefundResult(command.id, { ...facts, status: "FAILED" });
    assert.equal(await balance(), baseline);
    assert.equal((await capture(paid)).status, "captured");
    assert.equal((await state(id)).online_checkout_id, paid.id);
    assert.equal((await state(id)).revoked_at, null);
    await capture(paid);
    assert.equal(await balance(), baseline + 15);
  });

  await t.test(
    "pending refund on a partially refunded top-up keeps the remainder held",
    async () => {
      const baseline = await balance();
      const id = await quote("credits", 15, 1000);
      const paid = await capture(await attach(await store.create(user, input(id))));
      await store.reconcileRefund(paid.id, { captureId: paid.captureId, refundedMinor: 100 });
      assert.ok((await balance()) > baseline);
      const command = await store.reserveRefund(owner, paid.id, {
        requestId: randomUUID(),
        amountMinor: 100,
        reason: "second refund fixture",
      });
      const facts = {
        refundId: `REFUND${command.id}`,
        amountMinor: 100,
        captureId: paid.captureId,
      };
      const held = await store.attachRefundResult(command.id, { ...facts, status: "PENDING" });
      assert.equal(held.status, "review");
      assert.equal(held.refundedMinor, 100);
      assert.equal(await balance(), baseline);
      await store.attachRefundResult(command.id, { ...facts, status: "FAILED" });
      const current = await capture(paid);
      assert.equal(current.status, "review");
      assert.equal(current.refundedMinor, 100);
      assert.equal(await balance(), baseline);
    },
  );

  await t.test(
    "a fully corrected unfulfilled payment releases the quote while pending and partial corrections block it",
    async (t) => {
      const env = process.env;
      process.env = {
        ...env,
        PAYPAL_CHECKOUT_ENVIRONMENT: "live",
        PAYPAL_LIVE_CLIENT_ID: "local-fixture",
        PAYPAL_LIVE_CLIENT_SECRET: "local-fixture",
        PAYPAL_LIVE_MERCHANT_ID: "FIXTURE_MERCHANT",
        PAYPAL_LIVE_WEBHOOK_ID: "local-fixture",
        PAYPAL_CHECKOUT_PUBLIC_ORIGIN: "http://localhost",
      };
      t.after(() => {
        process.env = env;
      });
      const baseline = await balance();
      const id = await quote("credits", 8, 1000);
      const original = input(id);
      const attached = await attach(await store.create(user, original));
      await pool.query(
        "UPDATE paypal_checkout_order SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [attached.id],
      );
      const late = await capture(attached);
      const pending = async () =>
        (await marketing.read(headers(user), "credits", 0)).orders.find((order) => order.id === id)
          ?.onlinePending;
      const assertHeld = async () => {
        assert.equal(await pending(), true);
        assert.equal((await marketing.offer(headers(user), id)).orderId, late.id);
        await assert.rejects(store.create(user, input(id)), /QUOTE_PAYMENT_PENDING/);
        await assert.rejects(
          command(user, { action: "close", id }),
          (e) => e.code === "QUOTE_PAYMENT_PENDING",
        );
        await assert.rejects(bank(id, 1000), (e) => e.code === "QUOTE_PAYMENT_PENDING");
      };
      assert.equal(late.status, "review");
      assert.equal((await state(id)).online_checkout_id, null);
      await assertHeld();
      const facts = {
        providerOrderId: late.providerOrderId,
        captureId: late.captureId,
        merchantId: late.merchantId,
        amountMinor: late.amountMinor,
        currency: "EUR",
        completedAt: late.capturedAt,
      };
      await store.settleRefundedCapture(late.id, facts, { refundedMinor: null, reversed: true });
      await assertHeld();
      await store.reconcileRefund(late.id, { captureId: late.captureId, refundedMinor: 3 });
      await assertHeld();
      assert.equal(await balance(), baseline);
      const full = { captureId: late.captureId, refundedMinor: late.amountMinor };
      await store.reconcileRefund(late.id, full);
      assert.equal(await pending(), false);
      assert.equal((await marketing.offer(headers(user), id)).orderId, undefined);
      await assert.rejects(
        marketing.offer(headers(other), id),
        (e) => e.code === "OFFER_NOT_FOUND",
      );
      assert.equal((await store.create(user, original)).id, late.id);
      const attempts = await Promise.all([
        store.create(user, input(id)),
        store.create(user, input(id)),
      ]);
      assert.equal(attempts[0].id, attempts[1].id);
      assert.notEqual(attempts[0].id, late.id);
      const stale = await store.settleRefundedCapture(late.id, facts, { refundedMinor: null });
      assert.equal(stale.refundTotalUnknown, false);
      assert.equal((await marketing.offer(headers(user), id)).orderId, attempts[0].id);
      const next = await attach(attempts[0]);
      await capture(next);
      await Promise.all([capture(next), store.reconcileRefund(late.id, full)]);
      assert.equal(await balance(), baseline + 8);
      assert.equal((await state(id)).online_checkout_id, next.id);
      assert.equal((await state(id)).revoked_at, null);
      assert.equal((await marketing.offer(headers(user), id)).orderId, next.id);
      assert.equal((await store.read(user, late.id)).status, "reversed");
      await store.reconcileRefund(next.id, {
        captureId: `CAPTURE${next.providerOrderId}`,
        refundedMinor: next.amountMinor,
      });
      assert.equal((await marketing.offer(headers(user), id)).orderId, next.id);
      await assert.rejects(store.create(user, input(id)), /QUOTE_NOT_PAYABLE/);
      assert.equal(await balance(), baseline);
    },
  );
  await t.test(
    "a confirmed full refund of a late production payment permits closing without inventing a production receipt",
    async () => {
      const business = await makeBusiness();
      for (const correctedFirst of [false, true]) {
        const id = await quote("photo", 1, 34000, business);
        const first = await attach(await store.create(user, input(id)));
        await pool.query(
          "UPDATE paypal_checkout_order SET expires_at=now()-interval '1 minute' WHERE id=$1",
          [first.id],
        );
        const captureId = `CAPTURE${first.providerOrderId}`;
        if (correctedFirst) {
          await store.settleRefundedCapture(
            first.id,
            {
              captureId,
              providerOrderId: first.providerOrderId,
              merchantId: first.merchantId,
              amountMinor: first.amountMinor,
              currency: "EUR",
              completedAt: new Date().toISOString(),
            },
            { refundedMinor: first.amountMinor },
          );
        } else {
          assert.equal((await capture(first)).status, "review");
          await store.reconcileRefund(first.id, { captureId, refundedMinor: first.amountMinor });
        }
        assert.equal((await store.read(user, first.id)).status, "refunded");
        assert.equal((await state(id)).status, "quoted");
        assert.equal((await state(id)).online_checkout_id, null);
        await command(user, { id, action: "close" });
        assert.equal((await state(id)).status, "closed");
        assert.equal(
          (await pool.query("SELECT id FROM billing_receipt WHERE production_order_id=$1", [id]))
            .rowCount,
          0,
        );
      }
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
  await verifyWallet(t, {
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
  });
  await t.test(
    "credits-only preserves verified PayPal settlement and releases abandoned offers",
    async () => {
      const strict = createCheckoutStore(pool, { platformCreditsOnly: true });
      const business = await makeBusiness();
      const banner = await quote("banner", 7, 1800, business);
      const feature = await quote("featured", 2, 600, business);

      const abandoned = await attach(await store.create(user, input(banner)));
      const alreadyPaid = await attach(await store.create(user, input(feature)));
      await assert.rejects(strict.create(user, input(banner)), /PLATFORM_CREDITS_ONLY/);
      await assert.rejects(strict.prepareCapture(user, abandoned.id), /PLATFORM_CREDITS_ONLY/);
      assert.equal(await strict.canCompleteApprovedPayment(user, abandoned), false);
      await assert.rejects(
        strict.cancelPromotion(other, abandoned.id, async () => true),
        /ORDER_NOT_FOUND/,
      );
      await assert.rejects(
        strict.cancelPromotion(user, abandoned.id, async () => false),
        /ORDER_CANCELLATION_UNAVAILABLE/,
      );
      const cancelled = await strict.cancelPromotion(user, abandoned.id, async () => true);
      assert.equal(cancelled.status, "cancelled");
      assert.equal((await state(banner)).status, "quoted");
      await command(user, { id: banner, action: "close" });

      const settled = await strict.settleCapture(alreadyPaid.id, {
        providerOrderId: alreadyPaid.providerOrderId,
        captureId: `CAPTURE${alreadyPaid.providerOrderId}`,
        merchantId: alreadyPaid.merchantId,
        amountMinor: alreadyPaid.amountMinor,
        currency: "EUR",
        completedAt: new Date().toISOString(),
      });
      assert.equal(settled.status, "captured");
      assert.equal((await state(feature)).online_checkout_id, alreadyPaid.id);
    },
  );
}
