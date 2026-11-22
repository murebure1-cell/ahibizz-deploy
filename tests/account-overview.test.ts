import assert from "node:assert/strict";
import test from "node:test";
import { readOverview, readPlacements } from "../src/lib/account-overview";
import { accountDate, bosnianDateTime } from "../src/lib/display-date";

test("Bosnian dates are padded, zoned and safe for unavailable values", () => {
  assert.equal(accountDate("2026-11-18T23:30:00.000Z"), "19. 11. 2026.");
  assert.equal(accountDate("2027-05-31T22:30:00.000Z"), "01. 06. 2027.");
  assert.equal(accountDate("invalid"), "—");
  assert.equal(bosnianDateTime("2026-11-18T23:30:00Z"), "19. 11. 2026. 00:30");
  assert.equal(bosnianDateTime("invalid"), "—");
  assert.equal(accountDate("2026-11-18T23:30:00Z", "America/New_York"), "18. 11. 2026.");
});

test("private account reads reject foreign and malformed balances and placements", () => {
  const facts = {
    accountId: "member-1",
    joinedAt: "2026-11-18T23:30:00.000Z",
    businesses: 1,
    promotedBusinesses: 1,
    credits: 5,
    unreadThreads: 0,
  };
  assert.deepEqual(readOverview({ overview: facts }, "member-1"), facts);
  assert.throws(() => readOverview({ overview: facts }, "member-2"));
  assert.throws(() => readOverview({ overview: { ...facts, credits: null } }, "member-1"));
  const item = {
    id: "8b067c42-465d-480b-ac40-83091a482b93",
    title: "Profil",
    kind: "nearby",
    endsAt: "2026-12-01T14:00:00Z",
  };
  const placements = { accountId: "member-1", items: [item] };
  assert.deepEqual(readPlacements({ placements }, "member-1"), placements);
  assert.throws(() => readPlacements({ placements }, "member-2"));
  assert.throws(() =>
    readPlacements(
      { placements: { ...placements, items: [{ ...item, kind: "credits" }] } },
      "member-1",
    ),
  );
});
