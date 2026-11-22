import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createPublicDirectoryService } from "../../src/server/directory/read-service.ts";
import { createCheckoutStore, promotionSql } from "../../src/server/paypal/store.ts";
import { verifyMarketingOnlineQuotes } from "./marketing-online-cases.mjs";
import { integrationConfiguration } from "./postgres.test.mjs";
import { verifyWalletCategoryPromotion } from "./wallet-promotion-cases.mjs";

test("durable checkout isolated PostgreSQL authority, replay, rights and refunds", {
  timeout: 90000,
}, async (t) => {
  const configuration = integrationConfiguration(process.env);
  const schema = `ci_paypal_${randomBytes(10).toString("hex")}`;
  const admin = new Pool({ ...configuration, max: 1 });
  let pool;
  let created = false;
  try {
    assert.deepEqual(
      (await admin.query("SELECT current_database() AS db,current_user AS role")).rows,
      [{ db: "ahibizz_ci", role: "ahibizz_ci" }],
    );
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    pool = new Pool({ ...configuration, options: `-c search_path=${schema}`, max: 8 });
    await runMigrations({ pool, migrations: await loadMigrations() });
    const store = createCheckoutStore(pool);
    const user = { userId: "buyer-fixture", id: "buyer-session", token: "buyer-token" };
    const other = { userId: "other-fixture", id: "other-session", token: "other-token" };
    const owner = { userId: "owner-fixture", id: "owner-session", token: "owner-token" };
    for (const [a, role] of [
      [user, "member"],
      [other, "member"],
      [owner, "owner"],
    ]) {
      await pool.query(
        "INSERT INTO auth_user(id,name,email,\"emailVerified\",role,approval) VALUES($1,$2,$3,true,$4,'approved')",
        [a.userId, a.userId, `${a.userId}@fixture.invalid`, role],
      );
      await pool.query(
        'INSERT INTO auth_session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval \'1 day\')',
        [a.id, a.token, a.userId],
      );
    }
    const category = randomUUID(),
      category2 = randomUUID();
    await pool.query(
      "INSERT INTO directory_category(id,name,slug) VALUES($1,'Fixture category','fixture'),($2,'Other category','other-fixture')",
      [category, category2],
    );
    const makeBusiness = async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,'Fixture business',$3,'published',now())",
        [id, user.userId, category],
      );
      return id;
    };
    const make = async (kind = "promotion", environment = "live") =>
      store.create(user, {
        requestId: randomUUID(),
        kind,
        ...(kind === "promotion" ? { businessId: await makeBusiness() } : {}),
        amountMinor: kind === "promotion" ? 511 : 100,
        merchantId: "FIXTURE_MERCHANT",
        environment,
        offerVersion: "fixture-v1",
      });
    let sequence = 0;
    const attach = async (o) =>
      store.attachProvider(o.id, {
        providerOrderId: `FIXTURE${String(++sequence).padStart(10, "0")}`,
        approvalUrl:
          o.environment === "live"
            ? "https://www.paypal.com/checkoutnow?token=fixture"
            : "https://www.sandbox.paypal.com/checkoutnow?token=fixture",
      });
    const capture = async (o, event) =>
      store.settleCapture(
        o.id,
        {
          providerOrderId: o.providerOrderId,
          captureId: `CAPTURE${o.providerOrderId}`,
          merchantId: o.merchantId,
          amountMinor: o.amountMinor,
          currency: "EUR",
          completedAt: new Date().toISOString(),
        },
        event,
      );
    const visible = async (id) =>
      (
        await pool.query(
          `SELECT ${promotionSql("b")} AS paid FROM directory_business b WHERE id=$1`,
          [id],
        )
      ).rows[0].paid;
    let first;
    await t.test("idempotent creation and ownership", async () => {
      const businessId = await makeBusiness();
      const input = {
        requestId: randomUUID(),
        kind: "promotion",
        businessId,
        amountMinor: 511,
        merchantId: "FIXTURE_MERCHANT",
        environment: "live",
        offerVersion: "fixture-v1",
      };
      first = await store.create(user, input);
      assert.equal((await store.create(user, input)).id, first.id);
      await assert.rejects(store.create(user, { ...input, amountMinor: 512 }), /COMMAND_CONFLICT/);
      await assert.rejects(store.read(other, first.id), /ORDER_NOT_FOUND/);
      await assert.rejects(
        store.read({ ...user, token: "wrong" }, first.id),
        /AUTHENTICATION_REQUIRED/,
      );
      await assert.rejects(
        store.create(other, { ...input, requestId: randomUUID() }),
        /BUSINESS_NOT_ELIGIBLE/,
      );
      await assert.rejects(
        pool.query("UPDATE paypal_checkout_order SET amount_minor=1 WHERE id=$1", [first.id]),
        /checkout_identity_immutable/,
      );
    });
    await t.test("only one concurrent promotion reserves a business", async () => {
      const businessId = await makeBusiness();
      const base = {
        kind: "promotion",
        businessId,
        amountMinor: 511,
        merchantId: "FIXTURE_MERCHANT",
        environment: "live",
        offerVersion: "v1",
      };
      const results = await Promise.allSettled([
        store.create(user, { ...base, requestId: randomUUID() }),
        store.create(user, { ...base, requestId: randomUUID() }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
      assert.equal(results[0].value.id, results[1].value.id);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM paypal_checkout_order WHERE business_id=$1",
            [businessId],
          )
        ).rows[0].n,
        1,
      );
    });
    await t.test("new request resumes only the unchanged owned unpaid promotion", async () => {
      const input = {
        requestId: randomUUID(),
        kind: "promotion",
        businessId: await makeBusiness(),
        amountMinor: 511,
        merchantId: "FIXTURE_MERCHANT",
        environment: "live",
        offerVersion: "resume-v1",
      };
      const created = await store.create(user, input);
      const again = await store.create(user, { ...input, requestId: randomUUID() });
      assert.equal(again.id, created.id);
      assert.equal(again.requestId, created.requestId);
      assert.equal(again.createRequestId, created.createRequestId);
      const ready = await attach(created);
      const resumed = await store.create(user, { ...input, requestId: randomUUID() });
      assert.equal(resumed.id, ready.id);
      assert.equal(resumed.providerOrderId, ready.providerOrderId);
      assert.equal(resumed.approvalUrl, ready.approvalUrl);
      assert.equal(resumed.captureRequestId, ready.captureRequestId);
      const sandbox = await store.create(user, {
        ...input,
        environment: "sandbox",
        requestId: randomUUID(),
      });
      assert.notEqual(sandbox.id, ready.id);
      assert.equal(sandbox.environment, "sandbox");
      for (const change of [
        { amountMinor: 512 },
        { merchantId: "OTHER" },
        { offerVersion: "resume-v2" },
      ]) {
        await assert.rejects(
          store.create(user, { ...input, ...change, requestId: randomUUID() }),
          /PROMOTION_ALREADY_RESERVED/,
        );
      }
      await assert.rejects(
        store.create({ ...user, token: "invalid" }, { ...input, requestId: randomUUID() }),
        /AUTHENTICATION_REQUIRED/,
      );
      await capture(ready);
      await assert.rejects(
        store.create(user, { ...input, requestId: randomUUID() }),
        /PROMOTION_ALREADY_RESERVED/,
      );
      const reviewInput = { ...input, businessId: await makeBusiness(), requestId: randomUUID() };
      const review = await store.create(user, reviewInput);
      await store.markReview(review.id);
      await assert.rejects(
        store.create(user, { ...reviewInput, requestId: randomUUID() }),
        /PROMOTION_ALREADY_RESERVED/,
      );
      const changedInput = { ...input, businessId: await makeBusiness(), requestId: randomUUID() };
      await store.create(user, changedInput);
      await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
        changedInput.businessId,
        category2,
      ]);
      await assert.rejects(
        store.create(user, { ...changedInput, requestId: randomUUID() }),
        /PROMOTION_ALREADY_RESERVED/,
      );
      await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
        changedInput.businessId,
        other.userId,
      ]);
      await assert.rejects(
        store.create(other, { ...changedInput, requestId: randomUUID() }),
        /PROMOTION_ALREADY_RESERVED/,
      );
    });
    await t.test(
      "guest orders retain their approval link and cannot be mistaken for wallet or SDK orders",
      async () => {
        const input = {
          requestId: randomUUID(),
          kind: "promotion",
          businessId: await makeBusiness(),
          amountMinor: 511,
          merchantId: "FIXTURE_MERCHANT",
          environment: "sandbox",
          offerVersion: "category-seven-days-20261118:guest",
        };
        const created = await store.create(user, input);
        await assert.rejects(
          store.attachProvider(created.id, {
            providerOrderId: "GUESTORDER123456",
            approvalUrl: null,
          }),
          /INVALID_APPROVAL_URL/,
        );
        const attached = await attach(created);
        for (const requestId of [input.requestId, randomUUID()]) {
          const resumed = await store.create(user, { ...input, requestId });
          assert.equal(resumed.id, attached.id);
          assert.equal(resumed.providerOrderId, attached.providerOrderId);
          assert.equal(resumed.approvalUrl, attached.approvalUrl);
          assert.equal(resumed.createRequestId, attached.createRequestId);
        }
        for (const offerVersion of [
          "category-seven-days-20261118",
          "category-seven-days-20261118:sdk",
          "category-seven-days-20261118:card-fields",
        ]) {
          await assert.rejects(store.create(user, { ...input, offerVersion }), /COMMAND_CONFLICT/);
          await assert.rejects(
            store.create(user, { ...input, offerVersion, requestId: randomUUID() }),
            /CHECKOUT_FLOW_MISMATCH/,
          );
          const existing = {
            ...input,
            offerVersion,
            requestId: randomUUID(),
            businessId: await makeBusiness(),
          };
          const previous = await store.create(user, existing);
          if (offerVersion.endsWith(":card-fields")) {
            const fields = await store.attachProvider(previous.id, {
              providerOrderId: "CARDFIELDS12345",
              approvalUrl: null,
            });
            assert.equal(fields.approvalUrl, null);
            assert.equal(fields.providerOrderId, "CARDFIELDS12345");
          }
          await assert.rejects(
            store.create(user, {
              ...existing,
              offerVersion: input.offerVersion,
              requestId: randomUUID(),
            }),
            /CHECKOUT_FLOW_MISMATCH/,
          );
        }
      },
    );
    await t.test(
      "SDK mode preserves neutral provider ID and cannot resume a wallet order",
      async () => {
        const input = {
          requestId: randomUUID(),
          kind: "promotion",
          businessId: await makeBusiness(),
          amountMinor: 511,
          merchantId: "FIXTURE_MERCHANT",
          environment: "sandbox",
          offerVersion: "category-seven-days-20261118:sdk",
        };
        const o = await store.create(user, input);
        const attached = await store.attachProvider(o.id, {
          providerOrderId: "SDKORDER12345678",
          approvalUrl: null,
        });
        assert.equal(attached.approvalUrl, null);
        const resumed = await store.create(user, { ...input, requestId: randomUUID() });
        assert.equal(resumed.providerOrderId, attached.providerOrderId);
        assert.equal(resumed.createRequestId, attached.createRequestId);
        await assert.rejects(
          store.create(user, {
            ...input,
            offerVersion: "category-seven-days-20261118",
            requestId: randomUUID(),
          }),
          /CHECKOUT_FLOW_MISMATCH/,
        );
        await assert.rejects(
          store.create(user, { ...input, offerVersion: "category-seven-days-20261118" }),
          /COMMAND_CONFLICT/,
        );
        const redirect = await make();
        await assert.rejects(
          store.attachProvider(redirect.id, {
            providerOrderId: "OTHERORDER123456",
            approvalUrl: null,
          }),
          /INVALID_APPROVAL_URL/,
        );
        await assert.rejects(
          store.create(user, {
            requestId: randomUUID(),
            kind: "promotion",
            businessId: redirect.businessId,
            amountMinor: redirect.amountMinor,
            merchantId: redirect.merchantId,
            environment: redirect.environment,
            offerVersion: "category-seven-days-20261118:sdk",
          }),
          /CHECKOUT_FLOW_MISMATCH/,
        );
      },
    );
    await t.test(
      "only an eligible owner can reopen an existing unpaid guest card order",
      async () => {
        const input = {
          requestId: randomUUID(),
          kind: "promotion",
          businessId: await makeBusiness(),
          amountMinor: 511,
          merchantId: "FIXTURE_MERCHANT",
          environment: "sandbox",
          offerVersion: "category-seven-days-20261118:guest",
        };
        const pending = await store.create(user, input);
        await assert.rejects(store.readPendingGuestCard(user, pending.id), /ORDER_NOT_PAYABLE/);
        assert.equal(await store.canCompleteApprovedPayment(user, pending), false);
        const attached = await attach(pending);
        const initialVersion = attached.version;
        const current = await store.readPendingGuestCard(user, pending.id);
        assert.equal(current.providerOrderId, attached.providerOrderId);
        assert.equal(current.version, initialVersion);
        assert.equal(await store.canCompleteApprovedPayment(user, attached), true);
        assert.equal(
          await store.canCompleteApprovedPayment(user, {
            ...attached,
            version: initialVersion - 1,
          }),
          false,
        );
        await assert.rejects(store.canCompleteApprovedPayment(other, attached), /ORDER_NOT_FOUND/);
        await assert.rejects(store.readPendingGuestCard(other, pending.id), /ORDER_NOT_FOUND/);
        await assert.rejects(
          store.readPendingGuestCard({ ...user, expectedAccountId: other.userId }, pending.id),
          /ACCOUNT_IDENTITY_CHANGED/,
        );
        const wallet = await attach(await make());
        await assert.rejects(store.readPendingGuestCard(user, wallet.id), /ORDER_NOT_PAYABLE/);
        await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
          input.businessId,
          category2,
        ]);
        await assert.rejects(store.readPendingGuestCard(user, pending.id), /BUSINESS_CHANGED/);
        assert.equal(await store.canCompleteApprovedPayment(user, attached), false);
        await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
          input.businessId,
          category,
        ]);
        await pool.query(
          "UPDATE paypal_checkout_order SET capture_lease_until=now()+interval '1 minute' WHERE id=$1",
          [pending.id],
        );
        await assert.rejects(store.readPendingGuestCard(user, pending.id), /ORDER_BUSY_OR_EXPIRED/);
        assert.equal(await store.canCompleteApprovedPayment(user, attached), false);
        await pool.query(
          "UPDATE paypal_checkout_order SET capture_lease_until=NULL, expires_at=now()-interval '1 second' WHERE id=$1",
          [pending.id],
        );
        await assert.rejects(store.readPendingGuestCard(user, pending.id), /ORDER_BUSY_OR_EXPIRED/);
        assert.equal(await store.canCompleteApprovedPayment(user, attached), false);
        assert.equal((await store.read(user, pending.id)).version, initialVersion);
      },
    );
    await t.test(
      "only the payer and current business owner can cancel an attached unpaid promotion",
      async () => {
        const origin = await make("promotion", "sandbox");
        const merchant = origin.merchantId;
        const find = (actor) =>
          store.readPendingPromotion(actor, origin.businessId, "sandbox", merchant);
        const unpaid = async (order) => {
          assert.equal(order.id, origin.id);
          return true;
        };
        const mustNotReadPayPal = async () => {
          assert.fail("Unsafe order reached PayPal");
        };
        assert.equal((await find(user)).id, origin.id);
        await assert.rejects(find(other), /BUSINESS_NOT_FOUND/);
        assert.equal(
          await store.readPendingPromotion(user, origin.businessId, "live", merchant),
          null,
        );
        await assert.rejects(
          store.cancelPromotion(user, origin.id, mustNotReadPayPal),
          /ORDER_CANCELLATION_UNAVAILABLE/,
        );
        const pending = await attach(origin);
        await assert.rejects(
          store.cancelPromotion(other, pending.id, mustNotReadPayPal),
          /ORDER_NOT_FOUND/,
        );
        await assert.rejects(
          store.cancelPromotion({ ...user, token: "wrong" }, pending.id, mustNotReadPayPal),
          /AUTHENTICATION_REQUIRED/,
        );
        await assert.rejects(
          store.cancelPromotion(user, pending.id, async () => false),
          /ORDER_CANCELLATION_UNAVAILABLE/,
        );
        await assert.rejects(
          store.cancelPromotion(user, pending.id, async () => {
            await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
              pending.businessId,
              other.userId,
            ]);
            return true;
          }),
          /ORDER_CANCELLATION_UNAVAILABLE/,
        );
        await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
          pending.businessId,
          user.userId,
        ]);
        const results = await Promise.all([
          store.cancelPromotion(user, pending.id, unpaid),
          store.cancelPromotion(user, pending.id, unpaid),
        ]);
        for (const cancelled of results) {
          assert.equal(cancelled.status, "cancelled");
          assert.equal(cancelled.version, pending.version + 1);
          assert.equal(cancelled.providerOrderId, pending.providerOrderId);
        }
        assert.equal(await find(user), null);
        await assert.rejects(store.prepareCapture(user, pending.id), /ORDER_NOT_PAYABLE/);
        const reconcileIds = async () =>
          (await store.listReconciliation("sandbox")).map(({ id }) => id);
        assert.ok((await reconcileIds()).includes(pending.id));
        await pool.query(
          "UPDATE paypal_checkout_order SET updated_at=now()-interval '73 hours' WHERE id=$1",
          [pending.id],
        );
        assert.ok(!(await reconcileIds()).includes(pending.id));
        assert.equal(
          (await store.findByProvider("sandbox", { providerOrderId: pending.providerOrderId })).id,
          pending.id,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM paypal_checkout_event WHERE order_id=$1 AND action='cancelled_unpaid'",
              [pending.id],
            )
          ).rows[0].n,
          1,
        );
        const replacement = await store.create(user, {
          requestId: randomUUID(),
          kind: "promotion",
          businessId: pending.businessId,
          amountMinor: pending.amountMinor,
          merchantId: merchant,
          environment: "sandbox",
          offerVersion: "fixture-v1:guest",
        });
        assert.notEqual(replacement.id, pending.id);
        assert.equal((await find(user)).id, replacement.id);
        const late = await capture(pending);
        assert.equal(late.status, "review");
        assert.equal((await capture(pending)).status, "review");
        const refunded = await store.settleRefundedCapture(
          pending.id,
          {
            providerOrderId: late.providerOrderId,
            captureId: late.captureId,
            merchantId: late.merchantId,
            amountMinor: late.amountMinor,
            currency: "EUR",
            completedAt: late.capturedAt,
          },
          { refundedMinor: late.amountMinor },
        );
        assert.equal(refunded.status, "refunded");
        const rights = await pool.query(
          "SELECT order_id FROM paypal_promotion_entitlement WHERE order_id=$1",
          [pending.id],
        );
        assert.equal(rights.rowCount, 0);
      },
    );
    await t.test(
      "cancellation loses to capture even if the capture lease has expired",
      async () => {
        const pending = await attach(await make());
        await assert.rejects(
          store.cancelPromotion(user, pending.id, async () => {
            await store.prepareCapture(user, pending.id);
            await pool.query(
              "UPDATE paypal_checkout_order SET capture_lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
              [pending.id],
            );
            return true;
          }),
          /ORDER_CANCELLATION_UNAVAILABLE/,
        );
        await assert.rejects(
          store.cancelPromotion(user, pending.id, async () =>
            assert.fail("Capture may be in flight"),
          ),
          /ORDER_CANCELLATION_UNAVAILABLE/,
        );
        assert.equal((await store.read(user, pending.id)).status, "provider_created");
        assert.equal((await capture(pending)).status, "captured");
        await assert.rejects(
          store.cancelPromotion(user, pending.id, async () => assert.fail("Already captured")),
          /ORDER_CANCELLATION_UNAVAILABLE/,
        );
      },
    );
    await t.test(
      "verified decline closes only an idle exact order, preserving late capture review",
      async () => {
        const pending = await attach(await make());
        const proof = {
          captureId: "CAPTUREDECLINE123",
          providerOrderId: pending.providerOrderId,
          merchantId: pending.merchantId,
          amountMinor: pending.amountMinor,
          currency: "EUR",
          completedAt: new Date().toISOString(),
        };
        const event = "EVENT-DECLINE";
        await assert.rejects(
          store.closeDeclinedPromotion(pending, { ...proof, amountMinor: 512 }, event),
          /DECLINE_MISMATCH/,
        );
        await store.prepareCapture(user, pending.id);
        const leased = await store.read(user, pending.id);
        await assert.rejects(
          store.closeDeclinedPromotion(leased, proof, event),
          /DECLINE_CONFIRMATION_PENDING/,
        );
        await pool.query(
          "UPDATE paypal_checkout_order SET capture_lease_until=now()-interval '61 seconds' WHERE id=$1",
          [pending.id],
        );
        await assert.rejects(
          store.closeDeclinedPromotion(leased, proof, event),
          /DECLINE_CONFIRMATION_PENDING/,
        );
        const eligible = await store.read(user, pending.id);
        const closed = await store.closeDeclinedPromotion(eligible, proof, event);
        assert.equal(closed.status, "cancelled");
        assert.equal(closed.captureId, null);
        assert.equal(closed.captureLeaseUntil, null);
        assert.equal(closed.refundedMinor, 0);
        assert.equal(
          (await store.closeDeclinedPromotion(eligible, proof, event)).version,
          closed.version,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM paypal_checkout_event WHERE order_id=$1 AND action='cancelled_declined'",
              [pending.id],
            )
          ).rows[0].count,
          1,
        );
        await assert.rejects(store.prepareCapture(user, pending.id), /ORDER_NOT_PAYABLE/);
        const late = await capture(pending, "EVENT-LATE-CAPTURE");
        assert.notEqual(late.captureId, proof.captureId);
        assert.equal(late.status, "review");
        assert.equal(await visible(pending.businessId), false);
      },
    );
    await t.test("capture lease, verified amount and exactly one grant", async () => {
      first = await attach(first);
      await store.prepareCapture(user, first.id);
      await assert.rejects(store.prepareCapture(user, first.id), /ORDER_BUSY_OR_EXPIRED/);
      await assert.rejects(
        store.settleCapture(first.id, {
          providerOrderId: first.providerOrderId,
          captureId: "WRONG",
          merchantId: first.merchantId,
          amountMinor: 1000,
          currency: "EUR",
          completedAt: new Date().toISOString(),
        }),
        /CAPTURE_MISMATCH/,
      );
      const paid = await capture(first, "EVENT-PAID");
      assert.equal(paid.status, "captured");
      assert.equal(Date.parse(paid.endsAt) - Date.parse(paid.startsAt), 7 * 86400000);
      assert.equal(await visible(first.businessId), true);
      const directory = createPublicDirectoryService({ database: pool });
      const previous = process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY;
      try {
        process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY = "true";
        assert.ok(
          (await directory.listPublic({ categoryId: category }, "category")).items.some(
            (item) => item.id === first.businessId,
          ),
        );
        assert.deepEqual(
          (await directory.listPublic({ categoryId: category2 }, "category")).items,
          [],
        );
        assert.ok(
          !(await directory.listPublic({}, true)).items.some(
            (item) => item.id === first.businessId,
          ),
        );
        process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY = "false";
        assert.deepEqual((await directory.listPublic({}, "category")).items, []);
      } finally {
        if (previous === undefined) delete process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY;
        else process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY = previous;
      }
      assert.equal((await capture(first, "EVENT-PAID")).captureId, paid.captureId);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM paypal_promotion_entitlement WHERE order_id=$1",
            [first.id],
          )
        ).rows[0].n,
        1,
      );
      first = paid;
    });
    await t.test(
      "refund reservation bounded, pending revokes, completion and replay safe",
      async () => {
        await assert.rejects(
          store.reserveRefund(user, first.id, {
            requestId: randomUUID(),
            amountMinor: 100,
            reason: "fixture refund",
          }),
          /OWNER_REQUIRED/,
        );
        const request = { requestId: randomUUID(), amountMinor: 100, reason: "fixture refund" };
        const command = await store.reserveRefund(owner, first.id, request);
        assert.equal((await store.reserveRefund(owner, first.id, request)).id, command.id);
        await assert.rejects(
          store.reserveRefund(owner, first.id, {
            requestId: randomUUID(),
            amountMinor: 500,
            reason: "too much",
          }),
          /REFUND_EXCEEDS_REMAINING/,
        );
        await store.attachRefundResult(command.id, {
          refundId: "REFUND-FIXTURE-1",
          status: "PENDING",
          amountMinor: 100,
          captureId: first.captureId,
        });
        assert.equal(await visible(first.businessId), false);
        const refunded = await store.attachRefundResult(command.id, {
          refundId: "REFUND-FIXTURE-1",
          status: "COMPLETED",
          amountMinor: 100,
          captureId: first.captureId,
        });
        assert.equal(refunded.refundedMinor, 100);
        assert.equal(refunded.status, "partially_refunded");
        await store.reconcileRefund(
          first.id,
          { captureId: first.captureId, refundedMinor: 511 },
          "EVENT-FULL-REFUND",
        );
        const stale = await store.reconcileRefund(
          first.id,
          { captureId: first.captureId, refundedMinor: 100 },
          "EVENT-OLD-PARTIAL",
        );
        assert.equal(stale.refundedMinor, 511);
        assert.equal(stale.status, "refunded");
        assert.equal((await capture(first)).status, "refunded");
        assert.equal(await visible(first.businessId), false);
      },
    );
    await t.test("ownership changes after approval record money but do not grant", async () => {
      const o = await attach(await make());
      await store.prepareCapture(user, o.id);
      await pool.query("UPDATE directory_business SET owner_user_id=$2 WHERE id=$1", [
        o.businessId,
        other.userId,
      ]);
      const paid = await capture(o);
      assert.equal(paid.status, "review");
      assert.equal(await visible(o.businessId), false);
    });
    await t.test(
      "failed pending refunds release the original promotion only after verified capture",
      async () => {
        const paid = await capture(await attach(await make()));
        const pending = async () => {
          const command = await store.reserveRefund(owner, paid.id, {
            requestId: randomUUID(),
            amountMinor: 20,
            reason: "failed refund fixture",
          });
          const facts = {
            refundId: `REFUND${command.id}`,
            captureId: paid.captureId,
            amountMinor: 20,
          };
          await store.attachRefundResult(command.id, { ...facts, status: "PENDING" });
          return { command, facts };
        };
        const first = await pending();
        const second = await pending();
        assert.equal(await visible(paid.businessId), false);
        assert.equal((await capture(paid)).status, "review");
        await store.attachRefundResult(first.command.id, { ...first.facts, status: "FAILED" });
        assert.equal((await capture(paid)).status, "review");
        await store.attachRefundResult(second.command.id, { ...second.facts, status: "FAILED" });
        assert.equal(await visible(paid.businessId), false);
        const replayed = await Promise.all([
          capture(paid, "REFUND-FAILED-A"),
          capture(paid, "REFUND-FAILED-B"),
        ]);
        for (const recovered of replayed) {
          assert.equal(recovered.status, "captured");
          assert.equal(recovered.startsAt, paid.startsAt);
          assert.equal(recovered.endsAt, paid.endsAt);
        }
        await store.attachRefundResult(first.command.id, { ...first.facts, status: "PENDING" });
        assert.equal(await visible(paid.businessId), true);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM paypal_checkout_event WHERE order_id=$1 AND action='refund_hold_released'",
              [paid.id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "failed refund cannot revive an independently revoked or uncertain right",
      async () => {
        for (const guard of ["business", "account", "unknown", "reversal"]) {
          const paid = await capture(await attach(await make()));
          const command = await store.reserveRefund(owner, paid.id, {
            requestId: randomUUID(),
            amountMinor: 20,
            reason: "check independent hold",
          });
          const facts = {
            refundId: `REFUND${command.id}`,
            captureId: paid.captureId,
            amountMinor: 20,
          };
          await store.attachRefundResult(command.id, { ...facts, status: "PENDING" });
          if (guard === "business") {
            await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
              paid.businessId,
              category2,
            ]);
            await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
              paid.businessId,
              category,
            ]);
          } else if (guard === "account") {
            await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [
              paid.userId,
            ]);
            await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [paid.userId]);
          } else if (guard === "unknown") {
            await store.markReview(paid.id);
          } else {
            await store.reconcileRefund(paid.id, {
              captureId: paid.captureId,
              refundedMinor: 20,
              reversed: true,
            });
          }
          await store.attachRefundResult(command.id, { ...facts, status: "FAILED" });
          assert.equal((await capture(paid)).status, guard === "reversal" ? "reversed" : "review");
          assert.equal(await visible(paid.businessId), false);
        }
      },
    );
    await t.test("sandbox never highlights public profile and support never grants", async () => {
      const o = await capture(await attach(await make("promotion", "sandbox")));
      assert.equal(o.status, "captured");
      assert.equal(await visible(o.businessId), false);
      const support = await capture(await attach(await make("support")));
      assert.equal(support.status, "captured");
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM paypal_promotion_entitlement WHERE order_id=$1",
            [support.id],
          )
        ).rows[0].n,
        0,
      );
    });
    await t.test(
      "category and account changes permanently revoke, even when restored",
      async () => {
        const o = await capture(await attach(await make()));
        assert.equal(await visible(o.businessId), true);
        await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
          o.businessId,
          category2,
        ]);
        await pool.query("UPDATE directory_business SET category_id=$2 WHERE id=$1", [
          o.businessId,
          category,
        ]);
        assert.equal(await visible(o.businessId), false);
        const p = await capture(await attach(await make()));
        await pool.query("UPDATE auth_user SET approval='suspended' WHERE id=$1", [user.userId]);
        await pool.query("UPDATE auth_user SET approval='approved' WHERE id=$1", [user.userId]);
        assert.equal(await visible(p.businessId), false);
      },
    );
    await t.test("unknown refunds require review; old paid event cannot revive", async () => {
      const o = await capture(await attach(await make()));
      await store.markReview(o.id, "EVENT-UNKNOWN-PARTIAL");
      assert.equal(await visible(o.businessId), false);
      await assert.rejects(
        store.reserveRefund(owner, o.id, {
          requestId: randomUUID(),
          amountMinor: 1,
          reason: "not reconciled",
        }),
        /ORDER_NOT_REFUNDABLE/,
      );
      assert.equal((await capture(o)).status, "review");
    });
    await t.test("refund arriving before paid event is atomic and cannot grant", async () => {
      for (const amount of [null, 511]) {
        const o = await attach(await make());
        const facts = {
          providerOrderId: o.providerOrderId,
          captureId: `EARLY${o.providerOrderId}`,
          merchantId: o.merchantId,
          amountMinor: o.amountMinor,
          currency: "EUR",
          completedAt: new Date().toISOString(),
        };
        const result = await store.settleRefundedCapture(
          o.id,
          facts,
          { refundedMinor: amount },
          `EARLY-REFUND-${amount}`,
        );
        assert.equal(result.status, amount === null ? "review" : "refunded");
        assert.equal(await visible(o.businessId), false);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM paypal_promotion_entitlement WHERE order_id=$1",
              [o.id],
            )
          ).rows[0].n,
          0,
        );
        assert.equal((await store.settleCapture(o.id, facts)).status, result.status);
      }
      const o = await attach(await make());
      await store.markReview(o.id, "UNKNOWN-BEFORE-CAPTURE");
      assert.equal((await capture(o)).status, "review");
      assert.equal(await visible(o.businessId), false);
    });
    await t.test("mixed external and internal partial totals block another refund", async () => {
      const o = await capture(await attach(await make()));
      await store.reconcileRefund(o.id, { captureId: o.captureId, refundedMinor: 50 });
      const command = await store.reserveRefund(owner, o.id, {
        requestId: randomUUID(),
        amountMinor: 100,
        reason: "mixed fixture",
      });
      const result = await store.attachRefundResult(command.id, {
        refundId: "MIXED-REFUND",
        status: "COMPLETED",
        amountMinor: 100,
        captureId: o.captureId,
      });
      assert.equal(result.refundTotalUnknown, true);
      assert.equal(result.status, "review");
      await assert.rejects(
        store.reserveRefund(owner, o.id, {
          requestId: randomUUID(),
          amountMinor: 1,
          reason: "unsafe balance",
        }),
        /ORDER_NOT_REFUNDABLE/,
      );
      const reconciled = await store.reconcileRefund(o.id, {
        captureId: o.captureId,
        refundedMinor: 150,
      });
      assert.equal(reconciled.refundTotalUnknown, false);
      assert.equal(reconciled.refundedMinor, 150);
    });
    await t.test("reconciliation pages are environment scoped and do not starve", async () => {
      await attach(await make("support", "sandbox"));
      await attach(await make("support", "live"));
      const expected = await store.listReconciliation("live", 100);
      const ids = [];
      let cursor;
      for (let page = 0; page < 100; page++) {
        const rows = await store.listReconciliation("live", 1, cursor);
        if (!rows.length) break;
        assert.equal(rows[0].environment, "live");
        ids.push(rows[0].id);
        cursor = rows[0].id;
      }
      assert.deepEqual(
        ids,
        expected.map((o) => o.id),
      );
      assert.equal(new Set(ids).size, ids.length);
      for (const environment of ["live", "sandbox"]) {
        const o = await capture(await attach(await make("support", environment)));
        const r = await store.reserveRefund(owner, o.id, {
          requestId: randomUUID(),
          amountMinor: 10,
          reason: "paging fixture",
        });
        assert.equal(
          (await store.listPendingRefunds(environment)).some((x) => x.id === r.id),
          false,
        );
        await store.attachRefundResult(r.id, {
          refundId: `PAGE${r.id}`,
          captureId: o.captureId,
          amountMinor: 10,
          status: "PENDING",
        });
      }
      const pending = await store.listPendingRefunds("live", 100);
      assert.equal(pending.length, 1);
      assert.equal((await store.listPendingRefunds("live", 1, pending[0].id)).length, 0);
      assert.equal((await store.readSystem(pending[0].orderId)).environment, "live");
      await assert.rejects(store.listReconciliation("live", 101), /INVALID_LIMIT/);
    });
    await t.test("expiry and late settlement cannot issue a second promotion", async () => {
      const o = await attach(await make());
      await pool.query(
        "UPDATE paypal_checkout_order SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [o.id],
      );
      await assert.rejects(store.prepareCapture(user, o.id), /ORDER_BUSY_OR_EXPIRED/);
      assert.equal((await capture(o)).status, "review");
      assert.equal(await visible(o.businessId), false);
      const p = await capture(await attach(await make()));
      await pool.query(
        "UPDATE paypal_promotion_entitlement SET starts_at=now()-interval '8 days',ends_at=now()-interval '1 day' WHERE order_id=$1",
        [p.id],
      );
      assert.equal(await visible(p.businessId), false);
    });
    await verifyMarketingOnlineQuotes(t, {
      pool,
      store,
      user,
      owner,
      other,
      makeBusiness,
      attach,
      capture,
    });
    await verifyWalletCategoryPromotion(t, {
      pool,
      store,
      user,
      owner,
      other,
      makeBusiness,
      visible,
      category2,
    });
  } finally {
    if (pool) await pool.end();
    if (created) {
      assert.match(schema, /^ci_paypal_[a-f0-9]{20}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin.end();
  }
});
