import assert from "node:assert/strict";
import test from "node:test";
import { type BusinessDetails, readBusinessDetails } from "../src/lib/business-details";
import {
  type HoursSpan,
  hoursNow,
  spanLabel,
  spanOfTimes,
  spanTimes,
  timeMinute,
  weekPause,
  weekSpans,
  weekWindows,
  withoutPause,
  withPause,
} from "../src/lib/business-hours";

type Windows = [number, number][];
const hours = (...days: Windows[]): NonNullable<BusinessDetails["hours"]> =>
  Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    windows: (days[index] ?? []).map(([startMinute, endMinute]) => ({ startMinute, endMinute })),
  }));
const details = (...days: Windows[]): BusinessDetails =>
  readBusinessDetails({ timezone: "UTC", hours: hours(...days), amenities: [] });
const span = (startMinute: number, endMinute: number, nextDay = false): HoursSpan => ({
  startMinute,
  endMinute,
  nextDay,
});
// 2026-11-16 is a Monday.
const monday = (time: string) => new Date(`2026-11-16T${time}:00Z`);

test("a night past midnight is one stretch of the day it starts on", () => {
  // Friday and Saturday from 18:00 to 02:00, Saturday also from 09:00 to 14:00.
  const kept = hours(
    [],
    [],
    [],
    [],
    [[1080, 1440]],
    [
      [0, 120],
      [540, 840],
      [1080, 1440],
    ],
    [[0, 120]],
  );
  const week = weekSpans(kept);
  assert.deepEqual(week[4], [span(1080, 120, true)]);
  assert.deepEqual(week[5], [span(540, 840), span(1080, 120, true)]);
  // Sunday has only the end of Saturday's night, so it is a closed day.
  assert.deepEqual(week[6], []);
  assert.equal(spanLabel(span(1080, 120, true)), "18:00–02:00");
  assert.deepEqual(weekWindows(week), kept);
});

test("Sunday's night runs into Monday, and whole days are not nights", () => {
  const kept = hours([[0, 180]], [], [], [], [], [], [[1260, 1440]]);
  const week = weekSpans(kept);
  assert.deepEqual(week[6], [span(1260, 180, true)]);
  assert.deepEqual(week[0], []);
  assert.deepEqual(weekWindows(week), kept);

  // Open all day, every day: each day keeps its own stretch.
  const always = hours(...Array.from({ length: 7 }, (): Windows => [[0, 1440]]));
  assert.deepEqual(
    weekSpans(always).map((day) => day.length),
    [1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(spanLabel(span(0, 1440)), "00:00–00:00");
  // An evening to midnight followed by a long morning is two days' work, not one night.
  const morning = weekSpans(hours([[1200, 1440]], [[0, 1300]]));
  assert.deepEqual(morning[0], [span(1200, 1440)]);
  assert.deepEqual(morning[1], [span(0, 1300)]);
});

test("an open business tells when it closes, also after midnight", () => {
  const lunch = details([
    [540, 720],
    [780, 1440],
  ]);
  assert.deepEqual(hoursNow(lunch, monday("09:30")), {
    weekday: 1,
    open: true,
    closesAt: 720,
    opensAt: null,
  });
  // Between the two stretches it is closed and says when it opens again.
  assert.deepEqual(hoursNow(lunch, monday("12:30")), {
    weekday: 1,
    open: false,
    closesAt: null,
    opensAt: 780,
  });
  // A stretch to midnight closes at midnight.
  assert.equal(hoursNow(lunch, monday("20:00"))?.closesAt, 0);
  assert.equal(hoursNow(lunch, monday("08:00"))?.opensAt, 540);

  const night = details([[1080, 1440]], [[0, 120]]);
  assert.equal(hoursNow(night, monday("23:00"))?.closesAt, 120);
  // After midnight it is still Monday's night, on Tuesday's clock.
  const late = hoursNow(night, new Date("2026-11-17T01:00:00Z"));
  assert.deepEqual(late, { weekday: 2, open: true, closesAt: 120, opensAt: null });
  assert.equal(hoursNow(night, new Date("2026-11-17T02:00:00Z"))?.open, false);
});

test("a business that never closes names no closing time", () => {
  const always = details(...Array.from({ length: 7 }, (): Windows => [[0, 1440]]));
  assert.deepEqual(hoursNow(always, monday("23:59")), {
    weekday: 1,
    open: true,
    closesAt: null,
    opensAt: null,
  });
  assert.equal(hoursNow({ timezone: null, hours: null, amenities: [] }, monday("10:00")), null);
  assert.equal(hoursNow(always, new Date(Number.NaN)), null);
});

test("clock times become stretches the way an owner means them", () => {
  assert.equal(timeMinute("08:30"), 510);
  for (const bad of ["", "8:30", "24:00", "12:60", "ab:cd"]) assert.equal(timeMinute(bad), null);
  assert.deepEqual(spanOfTimes("08:00", "20:00"), span(480, 1200));
  // Midnight as the end, and an end before the start on the next day.
  assert.deepEqual(spanOfTimes("18:00", "00:00"), span(1080, 1440));
  assert.deepEqual(spanOfTimes("18:00", "02:00"), span(1080, 120, true));
  assert.deepEqual(spanOfTimes("00:00", "00:00"), span(0, 1440));
  assert.equal(spanOfTimes("08:00", ""), null);
  assert.deepEqual(spanTimes(span(1080, 120, true)), { start: "18:00", end: "02:00" });
  assert.deepEqual(spanTimes(span(1080, 1440)), { start: "18:00", end: "00:00" });
});

test("a pause splits the days it fits into, and leaves the others", () => {
  const week = [
    [span(480, 1200)],
    [span(780, 1200)],
    [span(480, 720)],
    [],
    [span(600, 120, true)],
    [span(480, 600), span(660, 1200)],
    [],
  ];
  const paused = withPause(week, { startMinute: 720, endMinute: 780 });
  assert.deepEqual(paused[0], [span(480, 720), span(780, 1200)]);
  // The pause is not inside these days' hours.
  assert.deepEqual(paused[1], [span(780, 1200)]);
  assert.deepEqual(paused[2], [span(480, 720)]);
  assert.deepEqual(paused[3], []);
  // A night keeps its end on the next day.
  assert.deepEqual(paused[4], [span(600, 720), span(780, 120, true)]);
  // A day that already has two stretches is the owner's own arrangement.
  assert.deepEqual(paused[5], [span(480, 600), span(660, 1200)]);
  assert.deepEqual(weekPause(paused), { startMinute: 720, endMinute: 780 });
  assert.equal(weekPause(week.slice(0, 5)), null);

  const whole = withoutPause(paused);
  assert.deepEqual(whole[0], [span(480, 1200)]);
  assert.deepEqual(whole[4], [span(600, 120, true)]);
  assert.deepEqual(whole[5], [span(480, 1200)]);
  // A pause that is no interval changes nothing.
  assert.deepEqual(withPause(week, { startMinute: 780, endMinute: 720 }), week);
});
