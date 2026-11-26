import {
  type BusinessDetails,
  type BusinessHoursDay,
  businessLocalTime,
  businessTimeLabel,
} from "./business-details";

/**
 * Opening hours as people say them. They are kept as windows inside single days, so a bar open
 * from six in the evening until two is "18:00–24:00" on one day and "00:00–02:00" on the next.
 * Here that night is one stretch that belongs to the day it starts on.
 */
export type HoursSpan = {
  startMinute: number;
  /** Until 1440 on the same day; with `nextDay`, a minute of the following day. */
  endMinute: number;
  nextDay: boolean;
};

/** Seven days from Monday, each with its stretches; a night past midnight stays with its evening. */
export function weekSpans(hours: readonly BusinessHoursDay[]): HoursSpan[][] {
  // A window from midnight continues the evening before when that evening ran to midnight and
  // the continuation ends no later than the evening began. A longer one is a day of its own.
  const carried = hours.map((day, index) => {
    const first = day.windows[0];
    const before = hours[(index + 6) % 7]?.windows.at(-1);
    return first &&
      before &&
      first.startMinute === 0 &&
      first.endMinute < 1440 &&
      before.endMinute === 1440 &&
      first.endMinute <= before.startMinute
      ? first
      : null;
  });
  return hours.map((day, index) => {
    const own = carried[index] ? day.windows.slice(1) : day.windows;
    const next = carried[(index + 1) % 7];
    return own.map((window, at) =>
      next && at === own.length - 1 && window.endMinute === 1440
        ? { startMinute: window.startMinute, endMinute: next.endMinute, nextDay: true }
        : { startMinute: window.startMinute, endMinute: window.endMinute, nextDay: false },
    );
  });
}

/** The reverse of `weekSpans`: windows inside single days, as the hours are kept. */
export function weekWindows(week: readonly (readonly HoursSpan[])[]): BusinessHoursDay[] {
  const days = Array.from({ length: 7 }, () => [] as BusinessHoursDay["windows"]);
  week.slice(0, 7).forEach((spans, index) => {
    for (const span of spans) {
      if (!span.nextDay) {
        days[index]?.push({ startMinute: span.startMinute, endMinute: span.endMinute });
        continue;
      }
      days[index]?.push({ startMinute: span.startMinute, endMinute: 1440 });
      days[(index + 1) % 7]?.push({ startMinute: 0, endMinute: span.endMinute });
    }
  });
  return days.map((windows, index) => ({
    weekday: index + 1,
    windows: windows.sort((a, b) => a.startMinute - b.startMinute),
  }));
}

/** "08:00–22:00"; midnight at the end reads "00:00". */
export function spanLabel(span: HoursSpan): string {
  return `${businessTimeLabel(span.startMinute)}–${businessTimeLabel(span.endMinute % 1440)}`;
}

export type HoursNow = {
  /** Today on the business's own clock, 1 for Monday. */
  weekday: number;
  open: boolean;
  /** While open: the minute of the day at which it closes; null when it does not close then,
      because the next stretch begins at that very minute. */
  closesAt: number | null;
  /** While closed: the minute at which it opens later today, or null. */
  opensAt: number | null;
};

/** Whether a business is open at `now` and when that changes; null when it gave no hours. */
export function hoursNow(details: BusinessDetails | null | undefined, now: Date): HoursNow | null {
  const local = details?.hours ? businessLocalTime(details.timezone, now) : null;
  if (!local || !details?.hours || details.hours.length !== 7) return null;
  const week = weekSpans(details.hours);
  const today = local.weekday - 1;
  const spans = week[today] ?? [];
  const late = (week[(today + 6) % 7] ?? []).find(
    (span) => span.nextDay && local.minute < span.endMinute,
  );
  const current =
    late ??
    spans.find(
      (span) => span.startMinute <= local.minute && (span.nextDay || local.minute < span.endMinute),
    );
  if (!current)
    return {
      weekday: local.weekday,
      open: false,
      closesAt: null,
      opensAt: spans.find((span) => span.startMinute > local.minute)?.startMinute ?? null,
    };
  // The day and the minute at which this stretch ends.
  const tomorrow = current !== late && (current.nextDay || current.endMinute === 1440);
  const endDay = tomorrow ? (today + 1) % 7 : today;
  const endMinute = current.endMinute % 1440;
  const follows = (week[endDay] ?? []).some((span) => span.startMinute === endMinute);
  return {
    weekday: local.weekday,
    open: true,
    closesAt: follows ? null : endMinute,
    opensAt: null,
  };
}

/** "08:30" as a minute of the day; null for anything else. */
export function timeMinute(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

/**
 * A stretch from two clock times, as an owner enters them: an end at or before the start is on
 * the next day, and "00:00" as the end is midnight. Null when either time is not one.
 */
export function spanOfTimes(start: string, end: string): HoursSpan | null {
  const from = timeMinute(start);
  const to = timeMinute(end);
  if (from === null || to === null) return null;
  if (to > from) return { startMinute: from, endMinute: to, nextDay: false };
  if (to === 0) return { startMinute: from, endMinute: 1440, nextDay: false };
  return { startMinute: from, endMinute: to, nextDay: true };
}

export function spanTimes(span: HoursSpan): { start: string; end: string } {
  return {
    start: businessTimeLabel(span.startMinute),
    end: businessTimeLabel(span.endMinute % 1440),
  };
}

export type HoursPause = { startMinute: number; endMinute: number };

/** Each day with one stretch is split round the pause, where the pause lies inside the stretch. */
export function withPause(week: readonly HoursSpan[][], pause: HoursPause): HoursSpan[][] {
  if (pause.startMinute >= pause.endMinute || pause.endMinute > 1440) return week.map((day) => day);
  return week.map((day) => {
    const [only] = day;
    if (!only || day.length !== 1) return day;
    const end = only.endMinute + (only.nextDay ? 1440 : 0);
    if (only.startMinute >= pause.startMinute || pause.endMinute >= end) return day;
    return [
      { startMinute: only.startMinute, endMinute: pause.startMinute, nextDay: false },
      { startMinute: pause.endMinute, endMinute: only.endMinute, nextDay: only.nextDay },
    ];
  });
}

/** Each day becomes one stretch again, from its first opening to its last closing. */
export function withoutPause(week: readonly HoursSpan[][]): HoursSpan[][] {
  return week.map((day) => {
    const first = day[0];
    const last = day.at(-1);
    return first && last && day.length > 1
      ? [{ startMinute: first.startMinute, endMinute: last.endMinute, nextDay: last.nextDay }]
      : day;
  });
}

/** The pause of the first day that has one: the gap between its first two stretches. */
export function weekPause(week: readonly HoursSpan[][]): HoursPause | null {
  for (const day of week) {
    const [first, second] = day;
    if (first && second && !first.nextDay)
      return { startMinute: first.endMinute, endMinute: second.startMinute };
  }
  return null;
}
