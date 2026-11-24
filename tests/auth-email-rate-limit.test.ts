import assert from "node:assert/strict";
import test from "node:test";
import { createEmailRateLimiter, emailRateRules } from "../src/server/auth/email-rate-limit";

/** In-memory stand-in for the upsert: same fixed-window arithmetic as the SQL. */
function fakeTable() {
  const rows = new Map<string, { count: number; lastRequest: number }>();
  return {
    rows,
    async query(_text: string, values: unknown[] = []) {
      const [, key, at, windowMs] = values as [string, string, number, number];
      const row = rows.get(key);
      const next =
        !row || at - row.lastRequest >= windowMs
          ? { count: 1, lastRequest: at }
          : { count: row.count + 1, lastRequest: row.lastRequest };
      rows.set(key, next);
      return { rows: [{ count: next.count, lastRequest: String(next.lastRequest) }] };
    },
  };
}

test("sign-in allows eight attempts per address in fifteen minutes, then counts down", async () => {
  const table = fakeTable();
  let now = 1_000_000;
  const limit = createEmailRateLimiter(table, "fixture-secret", () => now);
  const rule = emailRateRules["/sign-in/email"];
  assert.ok(rule);
  for (let attempt = 0; attempt < rule.max; attempt++)
    assert.deepEqual(await limit("/sign-in/email", " Member@Fixture.invalid "), { allowed: true });
  now += 60_000;
  assert.deepEqual(await limit("/sign-in/email", "member@fixture.invalid"), {
    allowed: false,
    retryAfter: 14 * 60,
  });
  assert.deepEqual(await limit("/sign-in/email", "other@fixture.invalid"), { allowed: true });
  now += 14 * 60_000;
  assert.deepEqual(await limit("/sign-in/email", "member@fixture.invalid"), { allowed: true });
});

test("keys hold a keyed digest, never the address, and unknown paths are not limited", async () => {
  const table = fakeTable();
  const limit = createEmailRateLimiter(table, "fixture-secret");
  await limit("/request-password-reset", "member@fixture.invalid");
  const [key] = table.rows.keys();
  assert.match(key ?? "", /^ahibizz-email:\/request-password-reset:[a-f0-9]{64}$/);
  assert.equal(key?.includes("member"), false);
  const other = fakeTable();
  await createEmailRateLimiter(other, "another-secret")(
    "/request-password-reset",
    "member@fixture.invalid",
  );
  assert.notEqual([...other.rows.keys()][0], key);
  assert.deepEqual(await limit("/sign-out", "member@fixture.invalid"), { allowed: true });
  assert.deepEqual(await limit("/sign-in/email", undefined), { allowed: true });
  assert.equal(table.rows.size, 1);
});
