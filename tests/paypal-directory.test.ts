import assert from "node:assert/strict";
import test from "node:test";
import { listDirectory } from "../src/server/directory/read-service";

test("paid category ranking is release gated, public only and live-only", async () => {
  const before = process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY;
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [] };
    },
  };
  const input = { categoryId: "00000000-0000-4000-8000-000000000001" };
  try {
    delete process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY;
    await listDirectory(db, input, "true", [], true);
    assert.doesNotMatch(statements.pop() ?? "", /paypal_promotion_entitlement/);
    process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY = "true";
    await listDirectory(db, {}, "true", [], true);
    assert.doesNotMatch(statements.pop() ?? "", /paypal_promotion_entitlement/);
    await listDirectory(db, input, "true", [], false);
    assert.doesNotMatch(statements.pop() ?? "", /paypal_promotion_entitlement/);
    await listDirectory(db, input, "true", [], true);
    const sql = statements.pop() ?? "";
    assert.match(sql, /paypal_promotion_entitlement/);
    assert.match(sql, /po.environment='live'/);
    assert.match(sql, /pe.ends_at>now\(\)/);
    assert.match(sql, /pe.revoked_at IS NULL/);
    assert.match(sql, /po.refunded_minor=0/);
    assert.match(sql, /ORDER BY \(EXISTS/);
  } finally {
    if (before === undefined) delete process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY;
    else process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY = before;
  }
});
