import assert from "node:assert/strict";
import test from "node:test";
import { readOverview } from "../src/lib/account-overview";
import { accountDate, bosnianDateTime } from "../src/lib/display-date";

test("Bosnian dates are padded, zoned and safe for unavailable values", () => {
  assert.equal(accountDate("2026-11-18T23:30:00.000Z"), "19. 11. 2026.");
  assert.equal(accountDate("2027-05-31T22:30:00.000Z"), "01. 06. 2027.");
  assert.equal(accountDate("invalid"), "—");
  assert.equal(bosnianDateTime("2026-11-18T23:30:00Z"), "19. 11. 2026. 00:30");
  assert.equal(bosnianDateTime("invalid"), "—");
  assert.equal(accountDate("2026-11-18T23:30:00Z", "America/New_York"), "18. 11. 2026.");
});

test("private account reads reject foreign and malformed account facts", () => {
  const facts = {
    accountId: "member-1",
    joinedAt: "2026-11-18T23:30:00.000Z",
    businesses: 1,
    package: "basic",
    businessLimit: 1,
    promotedBusinesses: 1,
    unreadThreads: 0,
  };
  assert.deepEqual(readOverview({ overview: facts }, "member-1"), facts);
  const administrator = { ...facts, package: null, businessLimit: null };
  assert.deepEqual(readOverview({ overview: administrator }, "member-1"), administrator);
  for (const wrong of [
    { package: "basic", businessLimit: 3 },
    { package: "premium", businessLimit: 1 },
    { package: null, businessLimit: 1 },
    { package: "startup", businessLimit: null },
  ])
    assert.throws(() => readOverview({ overview: { ...facts, ...wrong } }, "member-1"));
  assert.throws(() => readOverview({ overview: facts }, "member-2"));
  assert.throws(() => readOverview({ overview: { ...facts, businesses: null } }, "member-1"));
});
