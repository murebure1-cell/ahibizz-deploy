import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { loadMigrations, runMigrations } from "../../scripts/migrate.mjs";
import { createDodoTestStore } from "../../src/server/dodo/test-store.ts";
import { integrationConfiguration } from "./postgres.test.mjs";

test("durable isolated Dodo test-only store", async (t) => {
  const config = integrationConfiguration(process.env),
    schema = `ci_dodo_${randomBytes(10).toString("hex")}`;
  const admin = new Pool(config);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ ...config, options: `-c search_path=${schema}`, max: 8 });
  try {
    await runMigrations({ pool, migrations: await loadMigrations() });
    const store = createDodoTestStore(pool);
    const actor = { userId: "dodo-fixture", id: "dodo-session", token: "dodo-token" };
    await pool.query(
      `INSERT INTO auth_user(id,name,email,"emailVerified",approval,role) VALUES($1,'Test','dodo@fixture.invalid',true,'approved','member')`,
      [actor.userId],
    );
    await pool.query(
      `INSERT INTO auth_session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 day')`,
      [actor.id, actor.token, actor.userId],
    );
    const category = randomUUID(),
      businessId = randomUUID();
    await pool.query(
      "INSERT INTO directory_category(id,name,slug) VALUES($1,'Dodo fixture','dodo-fixture')",
      [category],
    );
    await pool.query(
      "INSERT INTO directory_business(id,owner_user_id,title,category_id,status,published_at) VALUES($1,$2,'Dodo TEST',$3,'published',now())",
      [businessId, actor.userId, category],
    );
    const input = () => ({
      requestId: randomUUID(),
      businessId,
      merchantId: "bus_fixture",
      productId: "pdt_fixture",
    });
    const ns = "dodo:test_mode:bus_fixture",
      fp = "a".repeat(64);
    const session = (o) => ({
      sessionId: `cks_${o.id}`,
      checkoutUrl: `https://test.checkout.dodopayments.com/session/cks_${o.id}`,
    });
    const start = async (o) => {
      await store
        .scopedPersistence(actor, o.id)
        .createOnce(ns, o.requestId, fp, async () => session(o));
      return store.read(actor, o.id);
    };
    const proof = (o) => ({
      provider: "dodo",
      environment: "test_mode",
      orderId: o.id,
      merchantId: o.merchantId,
      productId: o.productId,
      sessionId: o.sessionId,
      paymentId: `pay_${o.id}`,
      amountMinor: 511,
      currency: "EUR",
      status: "succeeded",
    });
    await t.test("ownership and idempotent create", async () => {
      const i = input(),
        o = await store.create(actor, i);
      assert.equal((await store.create(actor, i)).id, o.id);
      await assert.rejects(
        store.create(actor, { ...i, productId: "pdt_other" }),
        /DODO_REQUEST_CONFLICT/,
      );
      await assert.rejects(store.read({ ...actor, token: "wrong" }, o.id), /DODO_AUTH_REQUIRED/);
    });
    await t.test(
      "concurrent durable reservation invokes callback once; persisted replay",
      async () => {
        const o = await store.create(actor, input());
        let calls = 0;
        const send = async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 100));
          return session(o);
        };
        const results = await Promise.allSettled([
          store.scopedPersistence(actor, o.id).createOnce(ns, o.requestId, fp, send),
          store.scopedPersistence(actor, o.id).createOnce(ns, o.requestId, fp, send),
        ]);
        assert.equal(calls, 1);
        assert.ok(results.filter((x) => x.status === "fulfilled").length >= 1);
        assert.deepEqual(
          await store.scopedPersistence(actor, o.id).createOnce(ns, o.requestId, fp, send),
          session(o),
        );
        assert.equal(calls, 1);
        await assert.rejects(
          store.scopedPersistence(actor, o.id).createOnce(ns, o.requestId, "b".repeat(64), send),
          /DODO_REQUEST_CONFLICT/,
        );
      },
    );
    await t.test("ambiguous provider call never retries", async () => {
      const o = await store.create(actor, input());
      let calls = 0;
      const send = async () => {
        calls++;
        throw Error("timeout");
      };
      await assert.rejects(
        store.scopedPersistence(actor, o.id).createOnce(ns, o.requestId, fp, send),
        /timeout/,
      );
      await assert.rejects(
        store.scopedPersistence(actor, o.id).createOnce(ns, o.requestId, fp, send),
        /DODO_CREATE_AMBIGUOUS/,
      );
      assert.equal(calls, 1);
      assert.equal((await store.read(actor, o.id)).status, "ambiguous");
    });
    await t.test("verified receipt only test record; refund review sticky", async () => {
      const o = await start(await store.create(actor, input()));
      await assert.rejects(
        store.settleVerified(o.id, { ...proof(o), merchantId: "wrong" }),
        /DODO_PROOF_MISMATCH/,
      );
      const paid = await store.settleVerified(o.id, proof(o));
      assert.equal(paid.status, "verified");
      assert.equal(new Date(paid.testEndsAt) - new Date(paid.testStartsAt), 7 * 86400000);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS n FROM paypal_promotion_entitlement")).rows[0].n,
        0,
      );
      await store.markReview(o.id);
      assert.equal((await store.settleVerified(o.id, proof(o))).status, "review");
    });
    await t.test("business change before settlement retains payment without grant", async () => {
      const o = await start(await store.create(actor, input()));
      await pool.query("UPDATE directory_business SET status='draft' WHERE id=$1", [businessId]);
      const paid = await store.settleVerified(o.id, proof(o));
      assert.equal(paid.status, "review");
      assert.equal(paid.testStartsAt, null);
      await pool.query("UPDATE directory_business SET status='published' WHERE id=$1", [
        businessId,
      ]);
    });
    await t.test("signed inbox durable dedup conflict and completion", async () => {
      const raw = '{"fixture":true}',
        hash = createHash("sha256").update(raw).digest("hex");
      assert.equal(await store.persistence.putVerifiedEvent(ns, "evt_fixture", raw, hash), true);
      assert.equal(await store.persistence.putVerifiedEvent(ns, "evt_fixture", raw, hash), false);
      const other = "{}";
      await assert.rejects(
        store.persistence.putVerifiedEvent(
          ns,
          "evt_fixture",
          other,
          createHash("sha256").update(other).digest("hex"),
        ),
        /DODO_EVENT_CONFLICT/,
      );
      const events = await store.pendingInbox();
      assert.equal(events.length, 1);
      await store.finishInbox(events[0].id, "processed");
      assert.equal((await store.pendingInbox()).length, 0);
    });
  } finally {
    await pool.end();
    assert.match(schema, /^ci_dodo_[a-f0-9]{20}$/);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
