import type { BookingSlot, BookingWindow } from "./booking";

const MINUTE = 60_000;
const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number[]>();

function formatter(timezone: unknown): Intl.DateTimeFormat | null {
  if (
    typeof timezone !== "string" ||
    timezone.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone)
  )
    return null;
  const cached = formatters.get(timezone);
  if (cached) return cached;
  try {
    const result = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      year: "numeric",
      era: "short",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timezone, result);
    return result;
  } catch {
    return null;
  }
}

export function isTimeZone(value: unknown): value is string {
  return formatter(value) !== null;
}

function utc(year: number, month: number, day: number): number {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(0, 0, 0, 0);
  return result.getTime();
}

function civil(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || year > 9999 || !month || month > 12 || !day || day > 31) return null;
  const epoch = utc(year, month, day);
  const date = new Date(epoch);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, epoch };
}

function parts(epoch: number, format: Intl.DateTimeFormat) {
  const values = Object.fromEntries(
    format.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]),
  );
  return {
    year: values.era === "BC" ? 1 - Number(values.year) : Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function dateKey(date: Date, timezone: string): string {
  const format = formatter(timezone);
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !format)
    throw new RangeError("Invalid booking date or timezone.");
  const value = parts(date.getTime(), format);
  if (value.year < 1 || value.year > 9999) throw new RangeError("Invalid booking date.");
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function addDays(date: string, count: number): string {
  const parsed = civil(date);
  if (!parsed || !Number.isSafeInteger(count)) throw new RangeError("Invalid booking date.");
  const result = new Date(parsed.epoch + count * DAY);
  if (
    !Number.isFinite(result.getTime()) ||
    result.getUTCFullYear() < 1 ||
    result.getUTCFullYear() > 9999
  )
    throw new RangeError("Invalid booking date.");
  return result.toISOString().slice(0, 10);
}

function candidateOffsets(
  date: string,
  epoch: number,
  timezone: string,
  format: Intl.DateTimeFormat,
) {
  const key = `${timezone}|${date}`;
  const cached = offsets.get(key);
  if (cached) return cached;
  const result = new Set<number>();
  // Sample both sides of a civil-day transition, including non-hour and date-line offsets.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = epoch + hours * 60 * MINUTE;
    const value = parts(sample, format);
    result.add(
      utc(value.year, value.month, value.day) +
        value.hour * 60 * MINUTE +
        value.minute * MINUTE +
        value.second * 1000 -
        sample,
    );
  }
  if (offsets.size >= 128) offsets.clear();
  const values = [...result];
  offsets.set(key, values);
  return values;
}

/** A repeated or nonexistent local minute has no unique instant and is rejected. */
export function localInstant(date: string, minute: number, timezone: string): string | null {
  const parsed = civil(date);
  const format = formatter(timezone);
  if (!parsed || !format || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const wall = parsed.epoch + minute * MINUTE;
  const matches = new Set<number>();
  for (const offset of candidateOffsets(date, parsed.epoch, timezone, format)) {
    const candidate = wall - offset;
    const value = parts(candidate, format);
    if (
      value.year === parsed.year &&
      value.month === parsed.month &&
      value.day === parsed.day &&
      value.hour === Math.floor(minute / 60) &&
      value.minute === minute % 60 &&
      value.second === 0
    )
      matches.add(candidate);
  }
  const [match] = matches;
  return matches.size === 1 && match !== undefined ? new Date(match).toISOString() : null;
}

export function dayBounds(date: string, timezone: string): { from: string; to: string } | null {
  if (!civil(date) || !isTimeZone(timezone)) return null;
  try {
    const from = localInstant(date, 0, timezone);
    const to = localInstant(addDays(date, 1), 0, timezone);
    return from && to && from < to ? { from, to } : null;
  } catch {
    return null;
  }
}

function instant(value: string): number | null {
  // Never let an offset-free input inherit the machine's timezone.
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !civil(value.slice(0, 10))
  )
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type DailySlotsInput = {
  date: string;
  timezone: string;
  windows: readonly BookingWindow[];
  durationMinutes: number;
  occupied: readonly BookingSlot[];
  now: Date;
};

export function dailySlots({
  date,
  timezone,
  windows,
  durationMinutes,
  occupied,
  now,
}: DailySlotsInput): BookingSlot[] {
  const parsed = civil(date);
  if (
    !parsed ||
    !isTimeZone(timezone) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 240 ||
    durationMinutes % 5 !== 0 ||
    !Array.isArray(windows) ||
    !Array.isArray(occupied)
  )
    return [];
  let today: ReturnType<typeof civil>;
  try {
    today = civil(dateKey(now, timezone));
  } catch {
    return [];
  }
  if (!today || parsed.epoch < today.epoch || parsed.epoch > today.epoch + 90 * DAY) return [];
  const busy: { start: number; end: number }[] = [];
  for (const item of occupied) {
    const start = item && instant(item.startsAt);
    const end = item && instant(item.endsAt);
    if (
      start === null ||
      end === null ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    )
      return [];
    busy.push({ start, end });
  }
  const weekday = ((new Date(parsed.epoch).getUTCDay() + 6) % 7) + 1;
  const slots = new Map<string, BookingSlot>();
  const converted = new Map<number, string | null>();
  function at(minute: number) {
    if (!converted.has(minute)) {
      try {
        converted.set(
          minute,
          minute === 1440
            ? localInstant(addDays(date, 1), 0, timezone)
            : localInstant(date, minute, timezone),
        );
      } catch {
        converted.set(minute, null);
      }
    }
    return converted.get(minute) ?? null;
  }
  for (const window of windows) {
    if (
      !window ||
      !Number.isInteger(window.weekday) ||
      window.weekday < 1 ||
      window.weekday > 7 ||
      !Number.isInteger(window.startMinute) ||
      window.startMinute < 0 ||
      !Number.isInteger(window.endMinute) ||
      window.endMinute > 1440 ||
      window.startMinute >= window.endMinute
    )
      return [];
    if (window.weekday !== weekday) continue;
    for (
      let minute = window.startMinute;
      minute + durationMinutes <= window.endMinute;
      minute += 15
    ) {
      const startsAt = at(minute);
      const endsAt = at(minute + durationMinutes);
      if (!startsAt || !endsAt) continue;
      const start = Date.parse(startsAt),
        end = Date.parse(endsAt);
      // A DST transition must not silently shorten or lengthen a priced service.
      if (start <= now.getTime() || end - start !== durationMinutes * MINUTE) continue;
      if (busy.some((item) => start < item.end && end > item.start)) continue;
      slots.set(startsAt, { startsAt, endsAt });
    }
  }
  return [...slots.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
