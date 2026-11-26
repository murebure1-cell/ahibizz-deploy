import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingDate,
  bookingMoney,
  bookingMonth,
  bookingShortDate,
  bookingShortDay,
} from "../src/lib/booking";

test("booking prices render integer cents in Bosnian KM notation without locale fallback", () => {
  for (const [minor, label] of [
    [0, "0,00 KM"],
    [1, "0,01 KM"],
    [4250, "42,50 KM"],
    [4500, "45,00 KM"],
    [10000000, "100.000,00 KM"],
  ] as const)
    assert.equal(bookingMoney(minor), label);
  for (const invalid of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(bookingMoney(invalid), "—");
});

test("month titles have explicit Bosnian names even if the runtime lacks bs-BA data", () => {
  assert.equal(bookingMonth("2026-11"), "Novembar 2026");
  assert.equal(bookingMonth("2027-01"), "Januar 2027");
  assert.equal(bookingMonth("2026-12"), "Decembar 2026");
  for (const invalid of ["2026-00", "2026-13", "2026-1", "2026-11-01", "0000-01"])
    assert.equal(bookingMonth(invalid), "—");
});

test("short day names are Bosnian by hand and follow the calendar day itself", () => {
  // 2026-11-26 is a Thursday; the week of days starts wherever the first bookable day falls.
  const week = [
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
    "2026-11-30",
    "2026-12-01",
    "2026-12-02",
  ];
  assert.deepEqual(
    week.map((day) => bookingShortDay(day)),
    ["Čet", "Pet", "Sub", "Ned", "Pon", "Uto", "Sri"],
  );
  assert.equal(bookingShortDate("2026-11-26"), "Čet 26. 11.");
  assert.equal(bookingShortDate("2026-12-01"), "Uto 1. 12.");
  assert.match(bookingShortDay("2026-11-26", "en"), /^Thu/);
  for (const invalid of ["", "2026-11", "26.11.2026", "2026-13-40"]) {
    assert.equal(bookingShortDay(invalid), "—");
    assert.equal(bookingShortDate(invalid), "—");
  }
});

test("date labels retain the business timezone at midnight/year boundaries and use h23 time", () => {
  assert.equal(
    bookingDate("2026-11-12T23:00:00.000Z", "Europe/Sarajevo", { time: true }),
    "13. 11. 2026. u 00:00",
  );
  assert.equal(
    bookingDate("2026-12-31T23:30:00.000Z", "Europe/Sarajevo", { time: true }),
    "01. 01. 2027. u 00:30",
  );
  assert.equal(
    bookingDate("2026-11-12T23:00:00.000Z", "UTC", { time: true }),
    "12. 11. 2026. u 23:00",
  );
  assert.equal(bookingDate("2026-11-12T23:00:00.000Z", "Europe/Sarajevo"), "13. 11. 2026.");
});

test("calendar accessible labels contain a distinct complete civil date and invalid inputs stay unknown", () => {
  const labels = Array.from({ length: 30 }, (_, index) =>
    bookingDate(`2026-11-${String(index + 1).padStart(2, "0")}T12:00:00Z`, "UTC"),
  );
  assert.equal(new Set(labels).size, 30);
  assert.equal(labels[11], "12. 11. 2026.");
  assert.equal(bookingDate("not-an-instant", "UTC"), "—");
  assert.equal(bookingDate("2026-11-12T00:00:00Z", "Not/AZone"), "—");
});
