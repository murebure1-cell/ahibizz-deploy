import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createBusinessReviewsMemory,
  reviewFixtureBusiness as id,
} from "./fixtures/business-reviews-memory";

test("actual component memory adapter supports save edit withdraw and restore", async () => {
  const memory = createBusinessReviewsMemory(),
    api = memory.api(),
    input = { rating: 5, text: "Moje iskustvo", expectedVersion: 0, idempotencyKey: randomUUID() };
  assert.deepEqual(memory.snapshot().summary, { count: 2, sum: 9 });
  const first = await api.save(id, input, "fixture-customer");
  assert.deepEqual(await api.save(id, input, "fixture-customer"), first);
  assert.deepEqual(memory.snapshot().summary, { count: 3, sum: 14 });
  const second = await api.save(
    id,
    { ...input, rating: 3, expectedVersion: 1, idempotencyKey: randomUUID() },
    "fixture-customer",
  );
  await api.withdraw(
    id,
    { expectedVersion: second.version, idempotencyKey: randomUUID() },
    "fixture-customer",
  );
  assert.deepEqual(memory.snapshot().summary, { count: 2, sum: 9 });
  await api.save(
    id,
    { ...input, expectedVersion: 3, idempotencyKey: randomUUID() },
    "fixture-customer",
  );
  assert.deepEqual(memory.snapshot().summary, { count: 3, sum: 14 });
});
test("fixture moderation excludes hidden scores, preserves rating and author withdrawal", async () => {
  const memory = createBusinessReviewsMemory(),
    page = await memory.admin.list(),
    row = page.items[0];
  assert.ok(row);
  await memory.admin.moderate(
    row.id,
    {
      hidden: true,
      reason: "Neprimjeren sadržaj",
      expectedVersion: row.version,
      idempotencyKey: randomUUID(),
    },
    "fixture-admin",
  );
  assert.deepEqual(memory.snapshot().summary, { count: 1, sum: 4 });
  assert.equal((await memory.admin.list()).items[0]?.rating, 5);
});
test("fixture never exposes private author name or links and owner cannot self rate", async () => {
  const memory = createBusinessReviewsMemory();
  assert.equal(JSON.stringify(memory.snapshot()).includes("PRIVATNO"), false);
  const own = await memory.api("fixture-owner").own(id);
  assert.equal(own.canReview, false);
  await assert.rejects(
    memory
      .api("fixture-owner")
      .save(
        id,
        { rating: 5, text: "Vlastito", expectedVersion: 0, idempotencyKey: randomUUID() },
        "fixture-owner",
      ),
    (e: unknown) => (e as Error).message === "OWN_BUSINESS_REVIEW",
  );
});
