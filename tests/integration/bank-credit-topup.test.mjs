import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createAccountErasure } from "../../src/server/account-erasure.ts";
import { createMarketingService } from "../../src/server/marketing/service.ts";
import { createCheckoutStore } from "../../src/server/paypal/store.ts";
import { readCreditBankConfiguration } from "../../src/server/wallet/bank-config.ts";
import { createBankTopUpService } from "../../src/server/wallet/bank-topup.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

const deny = (code) => (error) => error.code === code;
const fixtureConfiguration = (currency) =>
  readCreditBankConfiguration({
    AHIBIZZ_CREDIT_BANK_TRANSFER: JSON.stringify({
      enabled: true,
      commercialConfirmed: true,
      recipient: "Synthetic merchant",
      bank: {
        id: "fixture-bank",
        label: "Fixture bank transfer",
        name: "N26",
        currency,
        iban: "DE89 3704 0044 0532 0130 00",
      },
    }),
  });

test("bank credit topups reuse the immutable ledger and exact bank settlement with isolated PostgreSQL", {
  timeout: 90000,
}, async (t) => {
  const configuration = integrationConfiguration(process.env),
    schema = `ci_bank_${randomBytes(10).toString("hex")}`;
  const admin = new Pool({ ...configuration, max: 1 });
  let pool,
    created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    pool = new Pool({ ...configuration, options: `-c search_path=${schema}`, max: 8 });
    await runMigrations({ pool, migrations: await loadMigrations() });
    const actors = new Map();
    async function fixture(role = "member") {
      const actor = { userId: randomUUID(), id: randomUUID(), token: randomUUID() };
      await pool.query(
        `INSERT INTO auth_user(id,name,email,"emailVerified",role,approval) VALUES($1,'Synthetic buyer',$2,true,$3,'approved')`,
        [actor.userId, `${actor.userId}@fixture.invalid`, role],
      );
      await pool.query(
        `INSERT INTO auth_session(id,token,"userId","expiresAt") VALUES($1,$2,$3,clock_timestamp()+interval '1 day')`,
        [actor.id, actor.token, actor.userId],
      );
      actors.set(actor.token, actor);
      return actor;
    }
    const user = await fixture(),
      owner = await fixture("owner"),
      other = await fixture();
    const auth = {
      api: {
        async getSession({ headers }) {
          const actor = actors.get(headers.get("test-session"));
          return actor ? { user: { id: actor.userId }, session: actor } : null;
        },
      },
    };
    const headers = (actor) =>
      new Headers({ "test-session": actor.token, "X-AhiBizz-Account-ID": actor.userId });
    let config = fixtureConfiguration("EUR");
    assert.ok(config);
    const service = createBankTopUpService(auth, pool, () => config),
      marketing = createMarketingService(auth, pool),
      paypal = createCheckoutStore(pool);
    const input = (currency = "EUR", quantity = 60) => ({
      id: randomUUID(),
      quantity,
      expectedAmountMinor: currency === "EUR" ? 767 : 1500,
      currency,
    });
    const approve = (row, ref = `FIXTURE-${row.id}`) => ({
      expectedVersion: row.version,
      bankTransactionReference: ref,
      amountMinor: row.amountMinor,
      currency: row.currency,
      paymentReference: row.paymentReference,
    });
    const balance = async (actor) => (await marketing.read(headers(actor), "credits", 0)).balance;
    const quoteInput = (id) => ({
      kind: "quote",
      quoteId: id,
      requestId: randomUUID(),
      merchantId: "FIXTURE_MERCHANT",
      environment: "live",
      offerVersion: "marketing-quote-v1",
    });
    let first, firstInput;
    await t.test(
      "disabled commercial config offers no instructions or creation; six approved offers are unchanged",
      async () => {
        config = null;
        const data = await service.read(headers(user), "mine", 1);
        assert.equal(data.available, false);
        assert.equal(data.bank, null);
        assert.deepEqual(data.offers, []);
        await assert.rejects(
          service.create(headers(user), input()),
          deny("BANK_TOPUP_UNAVAILABLE"),
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM marketing_order")).rows[0].n,
          0,
        );
        config = fixtureConfiguration("EUR");
        assert.deepEqual(
          (await service.read(headers(user), "mine", 1)).offers.map((o) => [
            o.quantity,
            o.amountMinor,
          ]),
          [
            [60, 767],
            [130, 1023],
            [260, 1534],
            [675, 3068],
            [1400, 5624],
            [3000, 10737],
          ],
        );
      },
    );
    await t.test(
      "one pending request binds exact frozen instructions, idempotent identity and no credits",
      async () => {
        firstInput = input();
        const attempts = await Promise.all([
          service.create(headers(user), firstInput),
          service.create(headers(user), firstInput),
        ]);
        assert.deepEqual(attempts[0], attempts[1]);
        first = attempts[0].request;
        assert.equal(first.status, "pending");
        assert.equal(first.instructionsAvailable, true);
        assert.match(first.paymentReference, /^AHI-[A-F0-9]{32}$/);
        assert.equal(first.bank.purpose, "Dopuna Ahi kredita");
        assert.equal(first.bank.name, "N26");
        assert.equal(await balance(user), 0);
        await assert.rejects(
          service.create(headers(user), { ...firstInput, id: randomUUID() }),
          deny("BANK_TOPUP_PENDING"),
        );
        await assert.rejects(
          service.create(headers(other), firstInput),
          deny("BANK_TOPUP_CHANGED"),
        );
        await assert.rejects(
          service.create(headers(user), { ...firstInput, expectedAmountMinor: 1499 }),
          deny("BANK_TOPUP_CHANGED"),
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM ahi_wallet_bank_topup")).rows[0].n,
          1,
        );
        const generic = (await marketing.read(headers(user), "credits", 0)).orders.find(
          (o) => o.id === first.orderId,
        );
        assert.equal(generic.bankTopUp, true);
        await assert.rejects(
          marketing.command(headers(user), { action: "topUp", ...firstInput }),
          deny("INVALID_OFFER"),
        );
      },
    );
    await t.test(
      "bank metadata forbids generic confirmation, quote payment and direct unreviewed credit",
      async () => {
        await assert.rejects(
          marketing.command(headers(owner), {
            action: "confirm",
            id: first.orderId,
            amountMinor: first.originalBamMinor,
            reference: "BYPASS-FIXTURE",
          }),
          deny("BANK_TOPUP_REVIEW_REQUIRED"),
        );
        await assert.rejects(
          marketing.command(headers(user), {
            action: "topUp",
            id: randomUUID(),
            quantity: 60,
            expectedAmountMinor: 1500,
          }),
          deny("BANK_TOPUP_PENDING"),
        );
        await assert.rejects(paypal.create(user, quoteInput(first.orderId)), /QUOTE_NOT_PAYABLE/);
        await assert.rejects(
          pool.query(
            "UPDATE marketing_order SET status='paid',paid_at=now(),settled_by=$2,bank_reference='BYPASS' WHERE id=$1",
            [first.orderId, owner.userId],
          ),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          pool.query("UPDATE marketing_order SET amount_minor=1 WHERE id=$1", [first.orderId]),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          pool.query("UPDATE ahi_wallet_bank_topup SET currency='BAM' WHERE id=$1", [first.id]),
          (error) => error.code === "23514",
        );
        await assert.rejects(
          pool.query(
            "UPDATE ahi_wallet_bank_topup SET approved_by=$2,approved_at=now() WHERE id=$1",
            [first.id, owner.userId],
          ),
          (error) => error.code === "23514",
        );
        assert.equal(
          (
            await pool.query("SELECT approved_at FROM ahi_wallet_bank_topup WHERE id=$1", [
              first.id,
            ])
          ).rows[0].approved_at,
          null,
        );
        await assert.rejects(
          pool.query("DELETE FROM ahi_wallet_bank_topup WHERE id=$1", [first.id]),
          (error) => error.code === "23514",
        );
      },
    );
    await t.test(
      "admin requires exact amount, currency and payer reference; one receipt credits exactly once",
      async () => {
        await assert.rejects(
          service.approve(headers(user), first.id, approve(first)),
          deny("OWNER_REQUIRED"),
        );
        await assert.rejects(
          service.approve(headers(owner), first.id, { ...approve(first), amountMinor: 766 }),
          deny("AMOUNT_MISMATCH"),
        );
        await assert.rejects(
          service.approve(headers(owner), first.id, { ...approve(first), currency: "BAM" }),
          deny("AMOUNT_MISMATCH"),
        );
        await assert.rejects(
          service.approve(headers(owner), first.id, {
            ...approve(first),
            paymentReference: `AHI-${"F".repeat(32)}`,
          }),
          deny("AMOUNT_MISMATCH"),
        );
        const settled = await Promise.all([
          service.approve(headers(owner), first.id, approve(first)),
          service.approve(headers(owner), first.id, approve(first)),
        ]);
        assert.deepEqual(settled[0], settled[1]);
        assert.equal(settled[0].request.status, "approved");
        assert.equal(await balance(user), 60);
        await assert.rejects(
          pool.query("UPDATE marketing_order SET bank_reference='CHANGED-RECEIPT' WHERE id=$1", [
            first.orderId,
          ]),
          (error) => error.code === "23514",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM ahi_credit_movements WHERE account_id=$1",
              [user.userId],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM marketing_bank_receipt_claim WHERE reference=$1",
              [approve(first).bankTransactionReference.toUpperCase()],
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(
          service.cancel(headers(user), first.id, { expectedVersion: 2 }),
          deny("BANK_TOPUP_CHANGED"),
        );
      },
    );
    await t.test(
      "globally reused bank receipt rolls back metadata and does not credit a second request",
      async () => {
        const second = (await service.create(headers(other), input())).request;
        await assert.rejects(
          service.approve(
            headers(owner),
            second.id,
            approve(second, approve(first).bankTransactionReference),
          ),
          deny("BANK_REFERENCE_USED"),
        );
        const pending = (await service.read(headers(other), "mine", 1)).requests[0];
        assert.equal(pending.approvedAt, null);
        assert.equal(pending.status, "pending");
        assert.equal(await balance(other), 0);
        await service.cancel(headers(other), second.id, { expectedVersion: 1 });
      },
    );
    await t.test(
      "frozen receiver survives rotation, disabled replay is read-only, cancellation retains bank ownership",
      async () => {
        const saved = (await service.create(headers(user), input())).request;
        config = null;
        assert.equal(
          (await service.read(headers(user), "mine", 1)).requests[0].instructionsAvailable,
          false,
        );
        assert.deepEqual(
          (
            await service.create(headers(user), {
              id: saved.id,
              quantity: 60,
              expectedAmountMinor: 767,
              currency: "EUR",
            })
          ).request.bank,
          saved.bank,
        );
        config = { ...fixtureConfiguration("EUR"), fingerprint: "f".repeat(64) };
        const rotated = (await service.read(headers(user), "mine", 1)).requests[0];
        assert.equal(rotated.instructionsAvailable, false);
        assert.equal(rotated.bank.currency, "EUR");
        await assert.rejects(
          service.cancel(headers(other), saved.id, { expectedVersion: 1 }),
          deny("BANK_TOPUP_NOT_FOUND"),
        );
        await assert.rejects(
          service.cancel(headers(user), saved.id, { expectedVersion: 2 }),
          deny("BANK_TOPUP_CHANGED"),
        );
        assert.equal(
          (await service.cancel(headers(user), saved.id, { expectedVersion: 1 })).request.status,
          "cancelled",
        );
        await assert.rejects(paypal.create(user, quoteInput(saved.orderId)), /QUOTE_NOT_PAYABLE/);
        assert.equal(
          (
            await pool.query("SELECT count(*)::int n FROM ahi_wallet_bank_topup WHERE id=$1", [
              saved.id,
            ])
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "EUR is a frozen integer conversion of the same credit bundle, not a second credit rate",
      async () => {
        const eur = (await service.create(headers(user), input("EUR"))).request;
        assert.equal(eur.amountMinor, 767);
        assert.equal(eur.originalBamMinor, 1500);
        assert.equal(eur.currency, "EUR");
        await service.approve(headers(owner), eur.id, approve(eur));
        assert.equal(await balance(user), 120);
      },
    );
    await t.test(
      "late transfers need explicit admin proof and credit a closed request only once",
      async () => {
        const actor = await fixture();
        const saved = (await service.create(headers(actor), input("EUR"))).request;
        const cancelled = (await service.cancel(headers(actor), saved.id, { expectedVersion: 1 }))
          .request;
        await assert.rejects(
          service.approve(headers(owner), saved.id, approve(saved)),
          deny("BANK_TOPUP_CHANGED"),
        );
        await assert.rejects(
          service.approve(headers(actor), saved.id, approve(cancelled)),
          deny("OWNER_REQUIRED"),
        );
        assert.equal(
          (await service.approve(headers(owner), saved.id, approve(cancelled))).request.status,
          "approved",
        );
        await service.approve(headers(owner), saved.id, approve(cancelled));
        assert.equal(await balance(actor), 60);
        await assert.rejects(paypal.create(actor, quoteInput(saved.orderId)), /QUOTE_NOT_PAYABLE/);
      },
    );
    await t.test("an active online quote cannot acquire bank instructions", async () => {
      config = fixtureConfiguration("EUR");
      const actor = await fixture();
      const quote = await marketing.command(headers(actor), {
        action: "topUp",
        id: randomUUID(),
        quantity: 60,
        expectedAmountMinor: 1500,
      });
      const online = await paypal.create(actor, quoteInput(quote.id));
      assert.equal(online.status, "created");
      await assert.rejects(service.create(headers(actor), input()), deny("QUOTE_PAYMENT_PENDING"));
      assert.equal(
        (
          await pool.query("SELECT count(*)::int n FROM ahi_wallet_bank_topup WHERE order_id=$1", [
            quote.id,
          ])
        ).rows[0].n,
        0,
      );
    });
    await t.test("concurrent bank and PayPal reservations cannot both win", async () => {
      const actor = await fixture();
      const quote = await marketing.command(headers(actor), {
        action: "topUp",
        id: randomUUID(),
        quantity: 60,
        expectedAmountMinor: 1500,
      });
      const results = await Promise.allSettled([
        service.create(headers(actor), input()),
        paypal.create(actor, quoteInput(quote.id)),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const bankCount = (
        await pool.query("SELECT count(*)::int n FROM ahi_wallet_bank_topup WHERE order_id=$1", [
          quote.id,
        ])
      ).rows[0].n;
      const onlineCount = (
        await pool.query("SELECT count(*)::int n FROM paypal_checkout_order WHERE quote_id=$1", [
          quote.id,
        ])
      ).rows[0].n;
      assert.equal(bankCount + onlineCount, 1);
    });
    await t.test(
      "reads and approval retain exact session expiry and current admin role",
      async () => {
        await assert.rejects(
          service.read(headers(user), "admin", 1, "pending"),
          deny("OWNER_REQUIRED"),
        );
        const expired = await fixture();
        await pool.query(
          "UPDATE auth_session SET \"expiresAt\"=clock_timestamp()-interval '1 second' WHERE id=$1",
          [expired.id],
        );
        await assert.rejects(
          service.read(headers(expired), "mine", 1),
          deny("AUTHENTICATION_REQUIRED"),
        );
        await assert.rejects(
          service.create(headers(expired), input()),
          deny("AUTHENTICATION_REQUIRED"),
        );
        const suspended = await fixture();
        await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
          suspended.userId,
        ]);
        await assert.rejects(
          service.read(headers(suspended), "mine", 1),
          deny("ACCOUNT_SUSPENDED"),
        );
      },
    );
    await t.test("expiry after waiting on the exact session row denies the bank read", async () => {
      const actor = await fixture(),
        blocker = await pool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          `UPDATE auth_session SET "expiresAt"=clock_timestamp()+interval '250 milliseconds' WHERE id=$1`,
          [actor.id],
        );
        const reading = service.read(headers(actor), "mine", 1).then(
          () => null,
          (error) => error,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        await blocker.query("COMMIT");
        assert.equal((await reading)?.code, "AUTHENTICATION_REQUIRED");
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const revoked = await fixture();
      await pool.query("DELETE FROM auth_session WHERE id=$1", [revoked.id]);
      await assert.rejects(
        service.read(headers(revoked), "mine", 1),
        deny("AUTHENTICATION_REQUIRED"),
      );
    });
    await t.test("pending bank transfer prevents account erasure until resolved", async () => {
      const actor = await fixture();
      await service.create(headers(actor), input());
      const requestId = randomUUID();
      await pool.query(
        "INSERT INTO support_request(id,actor_id,subject,reference,details) VALUES($1,$2,'deletion','','Synthetic erase request')",
        [requestId, actor.userId],
      );
      await assert.rejects(
        createAccountErasure(auth, pool)(
          headers(owner),
          requestId,
          `${actor.userId}@fixture.invalid`,
        ),
        deny("ERASURE_PAYMENT_PENDING"),
      );
      assert.equal(
        (await pool.query("SELECT erased_at FROM auth_user WHERE id=$1", [actor.userId])).rows[0]
          .erased_at,
        null,
      );
    });
    await t.test(
      "bank history pages stay disjoint while one pending request leads older closures",
      async () => {
        const actor = await fixture();
        for (let i = 0; i < 21; i++) {
          const request = (await service.create(headers(actor), input())).request;
          await service.cancel(headers(actor), request.id, { expectedVersion: 1 });
        }
        const pending = (await service.create(headers(actor), input())).request;
        const firstPage = await service.read(headers(actor), "mine", 1),
          secondPage = await service.read(headers(actor), "mine", 2);
        assert.equal(firstPage.requests.length, 20);
        assert.equal(firstPage.hasMore, true);
        assert.equal(secondPage.requests.length, 2);
        assert.equal(secondPage.hasMore, false);
        assert.equal(firstPage.requests[0].id, pending.id);
        assert.equal(
          new Set([...firstPage.requests, ...secondPage.requests].map((r) => r.id)).size,
          22,
        );
      },
    );
    await t.test(
      "mine pagination prioritizes pending records and admin filters do not leak across customers",
      async () => {
        const pending = (await service.create(headers(user), input())).request;
        const mine = await service.read(headers(user), "mine", 1);
        assert.equal(mine.requests[0].id, pending.id);
        assert.equal(mine.requests[0].status, "pending");
        assert.ok(mine.requests.every((r) => r.accountId === undefined && r.email === undefined));
        const adminPending = await service.read(headers(owner), "admin", 1, "pending");
        assert.ok(adminPending.requests.length > 0);
        assert.ok(adminPending.requests.every((r) => r.status === "pending" && r.accountId));
        const approved = await service.read(headers(owner), "admin", 1, "approved");
        assert.equal(approved.requests.length, 3);
        assert.ok(approved.requests.every((r) => r.status === "approved"));
      },
    );
    await t.test(
      "bank-only restricts new PayPal attempts and safely reuses a compatible cancelled quote",
      async () => {
        const actor = await fixture();
        const quote = await marketing.command(headers(actor), {
          action: "topUp",
          id: randomUUID(),
          quantity: 60,
          expectedAmountMinor: 1500,
        });
        const original = quoteInput(quote.id);
        const saved = await paypal.create(actor, original);
        await paypal.attachProvider(saved.id, {
          providerOrderId: "BANKONLYFIXTUREORDER",
          approvalUrl: "https://www.paypal.com/checkoutnow?token=BANKONLYFIXTUREORDER",
        });
        const bankOnly = createCheckoutStore(pool, {
          creditTopUpBankOnly: true,
          creditCardTopUps: true,
          creditCardTopUpsPilotOwner: true,
        });
        const priorPolicy = process.env.AHIBIZZ_CREDIT_TOP_UP_BANK_ONLY;
        process.env.AHIBIZZ_CREDIT_TOP_UP_BANK_ONLY = "true";
        try {
          const wallet = await marketing.read(headers(actor), "credits", 0);
          assert.equal(wallet.creditTopUpBankOnly, true);
          assert.equal(wallet.creditCardTopUps, false);
          await assert.rejects(
            marketing.command(headers(actor), {
              action: "topUp",
              id: randomUUID(),
              quantity: 60,
              expectedAmountMinor: 1500,
            }),
            deny("CREDIT_TOP_UP_BANK_ONLY"),
          );
          await assert.rejects(bankOnly.create(actor, original), deny("CREDIT_TOP_UP_BANK_ONLY"));
          for (const method of ["redirect", "sdk", "guest", "card-fields"]) {
            await assert.rejects(
              bankOnly.create(actor, {
                ...quoteInput(quote.id),
                offerVersion: `marketing-quote-v1:${method}`,
              }),
              deny("CREDIT_TOP_UP_BANK_ONLY"),
            );
          }
          const savedAttempt = await bankOnly.read(actor, saved.id);
          assert.equal(savedAttempt.status, "provider_created");
          assert.equal(await paypal.canCompleteApprovedPayment(actor, savedAttempt), false);
          assert.equal(await bankOnly.canCompleteApprovedPayment(actor, savedAttempt), true);
          const bankInput = input();
          await assert.rejects(
            service.create(headers(actor), bankInput),
            deny("QUOTE_PAYMENT_PENDING"),
          );
          await assert.rejects(
            bankOnly.cancelPromotion(actor, saved.id, async () => false),
            deny("ORDER_CANCELLATION_UNAVAILABLE"),
          );
          assert.equal(await balance(actor), 0);
          assert.equal(
            (await bankOnly.cancelPromotion(actor, saved.id, async () => true)).status,
            "cancelled",
          );
          assert.equal(await bankOnly.canCompleteApprovedPayment(actor, savedAttempt), false);
          const bank = (await service.create(headers(actor), bankInput)).request;
          assert.equal(bank.orderId, quote.id);
          assert.equal(bank.status, "pending");
          assert.equal(await balance(actor), 0);
          await service.approve(headers(owner), bank.id, approve(bank));
          await service.approve(headers(owner), bank.id, approve(bank));
          assert.equal(await balance(actor), 60);
        } finally {
          if (priorPolicy === undefined) delete process.env.AHIBIZZ_CREDIT_TOP_UP_BANK_ONLY;
          else process.env.AHIBIZZ_CREDIT_TOP_UP_BANK_ONLY = priorPolicy;
        }
      },
    );
    await t.test("one-click approval funds a credits-only production quote once", async () => {
      const actor = await fixture();
      const bank = (await service.create(headers(actor), input())).request;
      const statement = {
        expectedVersion: bank.version,
        amountMinor: bank.amountMinor,
        currency: bank.currency,
        paymentReference: bank.paymentReference,
        statementMatched: true,
      };
      await assert.rejects(
        service.approve(headers(actor), bank.id, statement),
        (e) => e.status === 403,
      );
      assert.equal(await balance(actor), 0);
      await Promise.all([
        service.approve(headers(owner), bank.id, statement),
        service.approve(headers(owner), bank.id, statement),
      ]);
      assert.equal(await balance(actor), 60);
      const category = randomUUID();
      await pool.query(
        "INSERT INTO directory_category(id,name,slug) VALUES($1,'Fixture photography','fixture-photography')",
        [category],
      );
      const businessId = randomUUID();
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directory_business(id,owner_user_id,title,category_id,city) VALUES($1,$2,'Fixture studio',$3,'Tuzla')",
        [businessId, actor.userId, category],
      );
      const priorPolicy = process.env.AHIBIZZ_PLATFORM_CREDITS_ONLY;
      process.env.AHIBIZZ_PLATFORM_CREDITS_ONLY = "true";
      try {
        await marketing.command(headers(actor), {
          action: "request",
          id,
          kind: "photo_video",
          quantity: 1,
          businessId,
        });
        const quote = {
          action: "quote",
          id,
          creditPrice: 45,
          instructions: "Fotografisanje i video",
        };
        await assert.rejects(
          marketing.command(headers(owner), { ...quote, amountMinor: 450 }),
          deny("PLATFORM_CREDITS_ONLY"),
        );
        await marketing.command(headers(owner), quote);
        assert.equal((await marketing.offer(headers(actor), id)).offer.creditPrice, 45);
        await assert.rejects(
          marketing.command(headers(owner), {
            action: "confirm",
            id,
            amountMinor: 450,
            reference: "FIXTURE-OLD-FLOW",
          }),
          deny("PLATFORM_CREDITS_ONLY"),
        );
        await Promise.all([
          marketing.command(headers(actor), { action: "useCredits", id }),
          marketing.command(headers(actor), { action: "useCredits", id }),
        ]);
        assert.equal(await balance(actor), 15);
        assert.equal(
          (await pool.query("SELECT wallet_payment_id FROM marketing_order WHERE id=$1", [id]))
            .rows[0].wallet_payment_id,
          id,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM billing_receipt WHERE production_order_id=$1",
              [id],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        if (priorPolicy === undefined) delete process.env.AHIBIZZ_PLATFORM_CREDITS_ONLY;
        else process.env.AHIBIZZ_PLATFORM_CREDITS_ONLY = priorPolicy;
      }
    });
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
