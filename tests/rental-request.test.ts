import assert from "node:assert/strict";
import test from "node:test";
import {
  rentalDefaults,
  rentalInstant,
  rentalTimes,
  rentalUnits,
  rentalWhen,
  takenDays,
} from "../src/lib/rental-request";

const zone = "Europe/Sarajevo";

test("a chosen day and hour is an instant on the clock of the business", () => {
  assert.equal(rentalInstant("2026-11-27T09:00", zone), "2026-11-27T08:00:00.000Z");
  assert.equal(rentalInstant("2026-07-01T09:30", zone), "2026-07-01T07:30:00.000Z");
  // The night the clocks move forward has no 02:30.
  assert.equal(rentalInstant("2027-03-28T02:30", zone), null);
  for (const bad of ["", "2026-11-27", "2026-11-27 09:00", "27. 11. u 09:00"])
    assert.equal(rentalInstant(bad, zone), null);
});

test("a rental is counted in started hours or started 24-hour periods", () => {
  const from = "2026-11-27T08:00:00.000Z";
  assert.equal(rentalUnits("day", from, "2026-11-29T08:00:00.000Z"), 2);
  assert.equal(rentalUnits("day", from, "2026-11-29T08:01:00.000Z"), 3);
  assert.equal(rentalUnits("day", from, "2026-11-27T09:00:00.000Z"), 1);
  assert.equal(rentalUnits("hour", from, "2026-11-27T10:30:00.000Z"), 3);
  assert.equal(rentalUnits("hour", from, from), 0);
  assert.equal(rentalUnits("day", "2026-11-29T08:00:00.000Z", from), 0);
  assert.equal(rentalUnits("day", "nije", from), 0);
});

test("the hours offered are the half hours, and a time between them is kept", () => {
  const times = rentalTimes();
  assert.equal(times.length, 48);
  assert.equal(times[0], "00:00");
  assert.equal(times[19], "09:30");
  assert.equal(times.at(-1), "23:30");
  const kept = rentalTimes("09:15");
  assert.equal(kept.length, 49);
  assert.deepEqual(kept.slice(18, 21), ["09:00", "09:15", "09:30"]);
  assert.equal(rentalTimes("09:30").length, 48);
  assert.equal(rentalTimes("25:99").length, 48);
});

test("the first offer is tomorrow morning for a day, and the return stays after the pick-up", () => {
  const first = rentalDefaults("2026-11-30");
  assert.deepEqual(first, { pickup: "2026-12-01T09:00", dropoff: "2026-12-02T09:00" });
  // Moving the pick-up past the return carries the return to the same hour a day later.
  assert.deepEqual(rentalWhen(first, { pickup: "2026-12-05T14:00" }), {
    pickup: "2026-12-05T14:00",
    dropoff: "2026-12-06T14:00",
  });
  // An earlier pick-up leaves the return alone.
  assert.deepEqual(rentalWhen(first, { pickup: "2026-12-01T07:30" }), {
    pickup: "2026-12-01T07:30",
    dropoff: "2026-12-02T09:00",
  });
  // The return is the visitor's own choice, even a wrong one: the screen says so.
  assert.deepEqual(rentalWhen(first, { dropoff: "2026-11-30T09:00" }), {
    pickup: "2026-12-01T09:00",
    dropoff: "2026-11-30T09:00",
  });
});

test("taken days are named in order, joined where they touch, from today on", () => {
  const entries = [
    { startsAt: "2026-12-10T08:00:00.000Z", endsAt: "2026-12-11T08:00:00.000Z" },
    { startsAt: "2026-12-02T08:00:00.000Z", endsAt: "2026-12-04T08:00:00.000Z" },
    // Ends at midnight in Sarajevo: the 5th itself is free.
    { startsAt: "2026-12-04T10:00:00.000Z", endsAt: "2026-12-04T23:00:00.000Z" },
    { startsAt: "2026-11-20T08:00:00.000Z", endsAt: "2026-11-22T08:00:00.000Z" },
    { startsAt: "2026-12-30T08:00:00.000Z", endsAt: "2027-01-02T08:00:00.000Z" },
  ];
  assert.deepEqual(takenDays(entries, zone, "2026-11-26"), {
    periods: ["2.–4. 12.", "10.–11. 12.", "30. 12.–2. 1."],
    more: false,
  });
  assert.deepEqual(takenDays(entries, zone, "2026-11-26", "bs", 2), {
    periods: ["2.–4. 12.", "10.–11. 12."],
    more: true,
  });
  // A stretch that began before today is named from today.
  assert.deepEqual(takenDays(entries, zone, "2026-12-03", "bs", 1), {
    periods: ["3.–4. 12."],
    more: true,
  });
  assert.deepEqual(
    takenDays(
      [{ startsAt: "2026-12-02T08:00:00.000Z", endsAt: "2026-12-02T12:00:00.000Z" }],
      zone,
      "2026-11-26",
    ),
    { periods: ["2. 12."], more: false },
  );
  assert.match(takenDays(entries, zone, "2026-11-26", "en").periods[0] ?? "", /2.*–.*4/);
  assert.deepEqual(takenDays([], zone, "2026-11-26"), { periods: [], more: false });
  assert.deepEqual(takenDays([{ startsAt: "nije", endsAt: "ni ovo" }], zone, "2026-11-26"), {
    periods: [],
    more: false,
  });
});
