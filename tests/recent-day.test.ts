import assert from "node:assert/strict";
import test from "node:test";
import { recentDay } from "../src/lib/display-date";

// Wednesday 25 November 2026, 20:00 in Sarajevo.
const now = new Date("2026-11-25T19:00:00Z");
const at = (iso: string) => new Date(iso);

test("Bosnian days are written without the runtime's date data", () => {
  assert.equal(recentDay(at("2026-11-25T08:00:00Z"), now, "bs"), "danas");
  assert.equal(recentDay(at("2026-11-24T08:00:00Z"), now, "bs"), "jučer");
  assert.equal(recentDay(at("2026-11-23T08:00:00Z"), now, "bs"), "pon");
  assert.equal(recentDay(at("2026-11-21T08:00:00Z"), now, "bs"), "sub");
  assert.equal(recentDay(at("2026-11-19T08:00:00Z"), now, "bs"), "čet");
  // A week back and further in the same year: day and month.
  assert.equal(recentDay(at("2026-11-18T08:00:00Z"), now, "bs"), "18. 11.");
  assert.equal(recentDay(at("2026-03-05T08:00:00Z"), now, "bs"), "5. 3.");
  assert.equal(recentDay(at("2025-12-31T08:00:00Z"), now, "bs"), "31. 12. 2025.");
});

test("the line over a day of messages starts with a capital and never shortens a date", () => {
  assert.equal(recentDay(at("2026-11-25T08:00:00Z"), now, "bs", { heading: true }), "Danas");
  assert.equal(recentDay(at("2026-11-24T08:00:00Z"), now, "bs", { heading: true }), "Jučer");
  assert.equal(
    recentDay(at("2026-11-23T08:00:00Z"), now, "bs", { heading: true }),
    "23. 11. 2026.",
  );
  assert.equal(recentDay(at("2026-11-25T08:00:00Z"), now, "en", { heading: true }), "Today");
});

test("a day begins at midnight in Sarajevo, not after twenty-four hours", () => {
  // 23:30 the evening before is yesterday although it is less than a day ago.
  assert.equal(recentDay(at("2026-11-24T22:30:00Z"), now, "bs"), "jučer");
  // Half past midnight Sarajevo time is already today.
  assert.equal(recentDay(at("2026-11-24T23:30:00Z"), now, "bs"), "danas");
});

test("other languages use their own words, and a broken date is a dash", () => {
  assert.equal(recentDay(at("2026-11-24T08:00:00Z"), now, "en"), "yesterday");
  assert.equal(recentDay(at("2026-11-24T08:00:00Z"), now, "de"), "gestern");
  assert.equal(recentDay(at("2026-11-23T08:00:00Z"), now, "en"), "Mon");
  assert.equal(recentDay("nije datum", now, "bs"), "—");
});
