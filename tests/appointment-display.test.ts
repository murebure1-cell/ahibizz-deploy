import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentClock,
  appointmentDate,
  appointmentDay,
  appointmentHours,
  appointmentMoment,
  appointmentTile,
  outsideThisMonth,
  rentalSpan,
} from "../src/lib/appointment-display";

const zone = "Europe/Sarajevo";

test("the tile of an appointment is the weekday and the day where it takes place", () => {
  // 23:30 UTC on Wednesday is already Thursday in Sarajevo.
  const day = appointmentDay("2026-11-25T23:30:00Z", zone);
  assert.equal(day, "2026-11-26");
  assert.deepEqual(appointmentTile(day), { weekday: "Čet", number: "26" });
  assert.deepEqual(appointmentTile("2026-12-04"), { weekday: "Pet", number: "4" });
  assert.match(appointmentTile("2026-12-04", "en").weekday, /Fri/);
  for (const bad of [null, "", "4. 12. 2026.", "2026-12"])
    assert.deepEqual(appointmentTile(bad), { weekday: "—", number: "—" });
  assert.equal(appointmentDay("nije datum", zone), null);
  assert.equal(appointmentDay("2026-11-25T23:30:00Z", "Nigdje/Nema"), null);
});

test("an hour is told on the clock of the place", () => {
  assert.equal(appointmentClock("2026-11-26T09:00:00Z", zone), "10:00");
  assert.equal(appointmentClock("2026-07-01T07:05:00Z", zone), "09:05");
  assert.equal(appointmentClock("2026-11-26T23:30:00Z", zone), "00:30");
  assert.equal(appointmentClock("nije datum", zone), "—");
  assert.equal(appointmentClock("2026-11-26T09:00:00Z", "Nigdje/Nema"), "—");
});

test("a day inside a line is short, in Bosnian by hand, and says the year only when it differs", () => {
  assert.equal(appointmentDate("2026-11-29"), "ned 29. 11.");
  assert.equal(appointmentDate("2026-12-04", "bs", "2026"), "pet 4. 12.");
  assert.equal(appointmentDate("2027-01-03", "bs", "2026"), "ned 3. 1. 2027.");
  assert.match(appointmentDate("2026-11-29", "en"), /Sun.*29/);
  assert.match(appointmentDate("2027-01-03", "de", "2026"), /2027/);
  assert.equal(appointmentDate(null), "—");
  assert.equal(appointmentDate("29. 11."), "—");
  assert.equal(appointmentMoment("2026-11-29T08:00:00Z", zone), "ned 29. 11. u 09:00");
  assert.match(appointmentMoment("2026-11-29T08:00:00Z", zone, "en"), /Sun.*29.*09:00/);
  assert.equal(appointmentMoment("nije datum", zone), "—");
});

test("a service says its hours, and its day too when the tile alone would mislead", () => {
  const entry = {
    startsAt: "2026-11-26T09:00:00Z",
    endsAt: "2026-11-26T10:00:00Z",
    timezone: zone,
  };
  assert.equal(appointmentHours(entry, "2026-11-25"), "10:00–11:00");
  // The tile says "Čet 26": without the month that reads as this month's 26th.
  assert.equal(appointmentHours(entry, "2026-10-30"), "čet 26. 11. · 10:00–11:00");
  assert.equal(appointmentHours(entry, "2025-11-25"), "čet 26. 11. 2026. · 10:00–11:00");
  assert.equal(appointmentHours(entry, null), "10:00–11:00");
  assert.equal(outsideThisMonth("2026-12-01", "2026-11-30"), true);
  assert.equal(outsideThisMonth("2026-11-01", "2026-11-30"), false);
  assert.equal(outsideThisMonth("2027-11-30", "2026-11-30"), true);
  assert.equal(outsideThisMonth(null, "2026-11-30"), false);
});

test("a rented vehicle says when it is taken and when it comes back", () => {
  const entry = {
    startsAt: "2026-11-27T08:00:00Z",
    endsAt: "2026-11-29T08:00:00Z",
    timezone: zone,
  };
  assert.equal(rentalSpan(entry, "2026-11-26"), "09:00 – ned 29. 11. u 09:00");
  assert.equal(rentalSpan(entry, "2026-10-30"), "pet 27. 11. u 09:00 – ned 29. 11. u 09:00");
  const overNewYear = {
    startsAt: "2026-12-30T08:00:00Z",
    endsAt: "2027-01-02T08:00:00Z",
    timezone: zone,
  };
  assert.equal(rentalSpan(overNewYear, "2026-12-20"), "09:00 – sub 2. 1. 2027. u 09:00");
});
