import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCheckoutStore, promotionSql } from "../src/server/paypal/store";

test("public paid promotion predicate excludes sandbox, expired, refunded and changed profiles", () => {
  const sql = promotionSql("listing");
  for (const fragment of [
    "po.environment='live'",
    "po.status='captured'",
    "po.refunded_minor=0",
    "po.refund_total_unknown=false",
    "pe.revoked_at IS NULL",
    "pe.ends_at>now()",
    "listing.status='published'",
    "pe.user_id=listing.owner_user_id",
    "pe.category_id=listing.category_id",
    `pu."emailVerified"=true`,
  ])
    assert.ok(sql.includes(fragment), fragment);
  assert.throws(() => promotionSql("b; DELETE FROM auth_user"));
});
test("durable migration protects original prices and command/capture identity", () => {
  const sql = readFileSync("db/migrations/0021_paypal_checkout.sql", "utf8");
  for (const part of [
    "UNIQUE(user_id,request_id)",
    "UNIQUE(environment,provider_order_id)",
    "UNIQUE(environment,capture_id)",
    "PRIMARY KEY(environment,provider_event_id)",
    "ends_at=starts_at+interval '7 days'",
    "checkout_identity_immutable",
    "refund_total_cannot_decrease",
    "CREATE TRIGGER paypal_business_rights",
    "CREATE TRIGGER paypal_user_rights",
  ])
    assert.ok(sql.includes(part), part);
});
test("invalid order input is rejected before touching any database", async () => {
  let touched = false;
  const pool = {
    connect: async () => {
      touched = true;
      throw new Error("database must not be used");
    },
  };
  const store = createCheckoutStore(pool as never);
  const actor = { id: "session", userId: "user", token: "fixture" };
  await assert.rejects(
    store.create(actor, {
      requestId: "not-a-uuid",
      kind: "promotion",
      amountMinor: 511,
      merchantId: "fixture",
      environment: "sandbox",
      offerVersion: "v1",
    }),
  );
  await assert.rejects(
    store.create(actor, {
      requestId: "00000000-0000-4000-8000-000000000001",
      kind: "support",
      amountMinor: -1,
      merchantId: "fixture",
      environment: "sandbox",
      offerVersion: "v1",
    }),
  );
  assert.equal(touched, false);
});
