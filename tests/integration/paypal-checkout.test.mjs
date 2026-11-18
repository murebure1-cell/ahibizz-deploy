import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createCheckoutStore, promotionSql } from "../../src/server/paypal/store.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

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
  } finally {
    if (pool) await pool.end();
    if (created) {
      assert.match(schema, /^ci_paypal_[a-f0-9]{20}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin.end();
  }
});
