import assert from "node:assert/strict";
import test from "node:test";
import type { BookingWindow } from "../src/lib/booking";
import {
  addDays,
  dailySlots,
  dateKey,
  dayBounds,
  isTimeZone,
  localInstant,
} from "../src/lib/booking-time";

const timezone = "Europe/Sarajevo";
const allDays: BookingWindow[] = Array.from({ length: 7 }, (_, index) => ({
  weekday: index + 1,
  startMinute: 540,
  endMinute: 600,
}));
const base = {
  date: "2026-11-13",
  timezone,
  windows: allDays,
  durationMinutes: 30,
  occupied: [],
  now: new Date("2026-11-12T12:00:00.000Z"),
};

test("timezone validation accepts Intl IANA zones but rejects coerced, offset and oversized input", () => {
  for (const value of ["UTC", timezone, "Asia/Kathmandu", "Pacific/Apia", "Etc/GMT+12"])
    assert.equal(isTimeZone(value), true, value);
  for (const value of [undefined, null, 0, "", " UTC ", "+01:00", "Not/AZone", "a".repeat(65)])
    assert.equal(isTimeZone(value), false);
});

test("date keys use the selected timezone, including midnight and the adjacent UTC date", () => {
  assert.equal(dateKey(new Date("2026-11-12T00:00:00Z"), "UTC"), "2026-11-12");
  assert.equal(dateKey(new Date("2026-11-12T23:30:00Z"), timezone), "2026-11-13");
  assert.equal(dateKey(new Date("2026-11-12T00:30:00Z"), "America/New_York"), "2026-11-11");
  assert.throws(() => dateKey(new Date(Number.NaN), timezone), RangeError);
  assert.throws(() => dateKey(new Date("0000-01-01T00:00:00Z"), "UTC"), RangeError);
  assert.throws(() => dateKey(new Date(), "Not/AZone"), RangeError);
});

test("civil-day arithmetic validates the real calendar and leap years without year-00 coercion", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("0096-02-28", 1), "0096-02-29");
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01"])
    assert.throws(() => addDays(value, 1), RangeError);
  for (const count of [0.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => addDays("2026-11-12", count), RangeError);
  assert.throws(() => addDays("9999-12-31", 1), RangeError);
});

test("local conversion preserves minute zero and non-hour offsets, with no machine-local parsing", () => {
  assert.equal(localInstant("2026-11-12", 0, "UTC"), "2026-11-12T00:00:00.000Z");
  assert.equal(localInstant("0001-01-01", 0, "UTC"), "0001-01-01T00:00:00.000Z");
  assert.equal(localInstant("2026-11-12", 1439, "UTC"), "2026-11-12T23:59:00.000Z");
  assert.equal(localInstant("2026-11-12", 0, timezone), "2026-11-11T23:00:00.000Z");
  assert.equal(localInstant("2026-11-12", 0, "Asia/Kathmandu"), "2026-11-11T18:15:00.000Z");
  for (const minute of [-1, 1440, 1.5, Number.NaN])
    assert.equal(localInstant("2026-11-12", minute, timezone), null);
  assert.equal(localInstant("2026-02-30", 0, timezone), null);
  assert.equal(localInstant("2026-11-12", 0, "Not/AZone"), null);
});

test("Sarajevo nonexistent spring and repeated autumn minutes are rejected rather than snapped", () => {
  assert.equal(localInstant("2026-03-29", 150, timezone), null);
  assert.equal(localInstant("2026-10-25", 150, timezone), null);
  assert.equal(localInstant("2026-03-29", 90, timezone), "2026-03-29T00:30:00.000Z");
  assert.equal(localInstant("2026-03-29", 210, timezone), "2026-03-29T01:30:00.000Z");
  assert.equal(localInstant("2026-10-25", 90, timezone), "2026-10-24T23:30:00.000Z");
  assert.equal(localInstant("2026-10-25", 210, timezone), "2026-10-25T02:30:00.000Z");
  assert.equal(localInstant("2011-12-30", 720, "Pacific/Apia"), null);
});

test("day bounds describe actual 23/24/25-hour local days and reject skipped/invalid days", () => {
  assert.deepEqual(dayBounds("2026-11-12", "UTC"), {
    from: "2026-11-12T00:00:00.000Z",
    to: "2026-11-13T00:00:00.000Z",
  });
  for (const [date, hours] of [
    ["2026-03-29", 23],
    ["2026-10-25", 25],
  ] as const) {
    const bounds = dayBounds(date, timezone);
    assert.ok(bounds);
    assert.equal((Date.parse(bounds.to) - Date.parse(bounds.from)) / 3_600_000, hours);
  }
  assert.equal(dayBounds("2011-12-30", "Pacific/Apia"), null);
  assert.equal(dayBounds("2026-02-29", timezone), null);
  assert.equal(dayBounds("2026-11-12", "Not/AZone"), null);
});

test("slots use the ISO weekday, a 15-minute window-relative grid and exact service duration", () => {
  const slots = dailySlots({
    ...base,
    durationMinutes: 20,
    windows: [
      { weekday: 5, startMinute: 545, endMinute: 600 },
      { weekday: 4, startMinute: 600, endMinute: 660 },
      { weekday: 5, startMinute: 545, endMinute: 600 },
    ],
  });
  assert.deepEqual(slots, [
    { startsAt: "2026-11-13T08:05:00.000Z", endsAt: "2026-11-13T08:25:00.000Z" },
    { startsAt: "2026-11-13T08:20:00.000Z", endsAt: "2026-11-13T08:40:00.000Z" },
    { startsAt: "2026-11-13T08:35:00.000Z", endsAt: "2026-11-13T08:55:00.000Z" },
  ]);
});

test("occupied intervals are half-open and block every overlap without exposing appointment data", () => {
  const slots = dailySlots({
    ...base,
    durationMinutes: 15,
    occupied: [{ startsAt: "2026-11-13T08:15:00.000Z", endsAt: "2026-11-13T08:30:00.000Z" }],
  });
  assert.deepEqual(
    slots.map((slot) => slot.startsAt),
    ["2026-11-13T08:00:00.000Z", "2026-11-13T08:30:00.000Z", "2026-11-13T08:45:00.000Z"],
  );
  assert.deepEqual(
    dailySlots({
      ...base,
      occupied: [
        {
          startsAt: "2026-11-13T07:00:00.000Z",
          endsAt: "2026-11-13T10:00:00.000Z",
        },
      ],
    }),
    [],
  );
});

test("slots start strictly after now and remain within today through 90 local calendar days", () => {
  assert.deepEqual(dailySlots({ ...base, now: new Date("2026-11-13T08:15:00.000Z") }), [
    { startsAt: "2026-11-13T08:30:00.000Z", endsAt: "2026-11-13T09:00:00.000Z" },
  ]);
  const today = dateKey(base.now, timezone);
  assert.equal(dailySlots({ ...base, date: today }).length, 0); // Today's 09:00 is already past.
  assert.equal(dailySlots({ ...base, date: addDays(today, 90) }).length, 3);
  assert.deepEqual(dailySlots({ ...base, date: addDays(today, 91) }), []);
  assert.deepEqual(dailySlots({ ...base, date: addDays(today, -1) }), []);
});

test("a window can end at 24:00 without converting midnight zero to missing", () => {
  assert.deepEqual(
    dailySlots({
      ...base,
      timezone: "UTC",
      windows: [{ weekday: 5, startMinute: 1425, endMinute: 1440 }],
      durationMinutes: 15,
    }),
    [{ startsAt: "2026-11-13T23:45:00.000Z", endsAt: "2026-11-14T00:00:00.000Z" }],
  );
});

test("slots reject DST gaps/folds and never silently change elapsed service duration", () => {
  for (const date of ["2026-03-29", "2026-10-25"]) {
    const slots = dailySlots({
      ...base,
      date,
      now: new Date(`${addDays(date, -1)}T00:00:00Z`),
      windows: [{ weekday: 7, startMinute: 90, endMinute: 240 }],
    });
    assert.deepEqual(
      slots.map((slot) => dateKey(new Date(slot.startsAt), timezone)),
      slots.map(() => date),
    );
    assert.equal(slots.length, 3);
    for (const slot of slots) {
      assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), 30 * 60_000);
      assert.equal(
        new Intl.DateTimeFormat("en", {
          timeZone: timezone,
          hour: "numeric",
          hourCycle: "h23",
        }).format(new Date(slot.startsAt)),
        "03",
      );
    }
  }
  assert.deepEqual(
    dailySlots({
      ...base,
      date: "2026-03-29",
      now: new Date("2026-03-28T00:00:00Z"),
      windows: [{ weekday: 7, startMinute: 90, endMinute: 240 }],
      durationMinutes: 120,
    }),
    [],
  );
});

test("invalid duration, windows, occupancy or dates fail closed without mutating inputs", () => {
  const before = structuredClone(base);
  for (const durationMinutes of [0, 10, 16, 245, 30.5, Number.NaN])
    assert.deepEqual(dailySlots({ ...base, durationMinutes }), []);
  for (const window of [
    { weekday: 0, startMinute: 540, endMinute: 600 },
    { weekday: 8, startMinute: 540, endMinute: 600 },
    { weekday: 5, startMinute: -1, endMinute: 600 },
    { weekday: 5, startMinute: 600, endMinute: 600 },
    { weekday: 5, startMinute: 540, endMinute: 1441 },
  ])
    assert.deepEqual(dailySlots({ ...base, windows: [window] }), []);
  for (const occupied of [
    [{ startsAt: "2026-11-13T08:00:00", endsAt: "2026-11-13T09:00:00Z" }],
    [{ startsAt: "2026-02-30T08:00:00Z", endsAt: "2026-11-13T09:00:00Z" }],
    [{ startsAt: "2026-11-13T09:00:00Z", endsAt: "2026-11-13T08:00:00Z" }],
  ])
    assert.deepEqual(dailySlots({ ...base, occupied }), []);
  assert.deepEqual(dailySlots({ ...base, date: "2026-02-30" }), []);
  assert.deepEqual(dailySlots({ ...base, timezone: "Not/AZone" }), []);
  assert.deepEqual(dailySlots({ ...base, now: new Date(Number.NaN) }), []);
  assert.deepEqual(dailySlots({ ...base, now: new Date("0000-01-01T00:00:00Z") }), []);
  assert.deepEqual(base, before);
});
