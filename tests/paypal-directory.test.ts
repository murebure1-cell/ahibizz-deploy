import assert from "node:assert/strict";
import test from "node:test";
import { createPublicDirectoryService, listDirectory } from "../src/server/directory/read-service";

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
    const walletOnly = statements.pop() ?? "";
    assert.doesNotMatch(walletOnly, /paypal_promotion_entitlement/);
    assert.match(walletOnly, /ORDER BY \(EXISTS \(SELECT 1 FROM wallet_category_promotion/);
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
    assert.match(sql, /ORDER BY \(\(EXISTS/);
    assert.match(sql, /OR EXISTS \(SELECT 1 FROM wallet_category_promotion/);
  } finally {
    if (before === undefined) delete process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY;
    else process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY = before;
  }
});

test("home promotion queries stay bounded without changing public pagination", async () => {
  const parameters: unknown[][] = [];
  const directory = createPublicDirectoryService({
    database: {
      async query(_sql, values = []) {
        parameters.push(values);
        return { rows: [] };
      },
    },
  });
  await directory.homePromotions(true);
  await directory.homePromotions("category");
  await directory.homeAllPromotions(2);
  await directory.homeNewest();
  await directory.listPublic();
  await assert.rejects(() => directory.listPublic({ pageSize: 6 }), {
    code: "INVALID_DIRECTORY_INPUT",
    status: 400,
  });
  assert.deepEqual(parameters, [
    [7, 0],
    [7, 0],
    [7, 6],
    [7, 0],
    [21, 0],
  ]);
});

test("home newest stays organic and the paged promotions rail unions only current paid placements", async () => {
  const statements: string[] = [];
  const directory = createPublicDirectoryService({
    database: {
      async query(sql) {
        statements.push(sql);
        return { rows: [] };
      },
    },
  });
  await directory.homeNewest();
  assert.doesNotMatch(statements.pop() ?? "", /marketing_order|wallet_category_promotion/);
  await directory.homeAllPromotions(2);
  const sql = statements.pop() ?? "";
  assert.match(sql, /wallet_category_promotion/);
  assert.match(sql, /paid_package_placement\(b,'nearby'\)/);
  assert.match(sql, /paid_package_placement\(b,'featured'\)/);
  assert.match(sql, /b\.latitude IS NOT NULL AND b\.longitude IS NOT NULL/);
  assert.match(
    sql,
    /placement\.revoked_at IS NULL AND placement\.starts_at<=now\(\) AND placement\.ends_at>now\(\)/,
  );
  assert.match(sql, /ORDER BY b\.published_at DESC NULLS LAST, b\.id DESC/);
  assert.doesNotMatch(sql, /md5\(/);
});
