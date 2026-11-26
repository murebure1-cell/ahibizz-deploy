import { addDays, dateKey, localInstant } from "./booking-time";
import { intlLocale, type Locale } from "./i18n/locales";
import type { RentalInterval, RentalVehicle } from "./rentals";

/**
 * "2026-11-27T09:00" on the clock of the business, as an instant. Null for anything else, and
 * for an hour that does not exist there (the night the clocks move forward).
 */
export function rentalInstant(value: string, zone: string): string | null {
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)$/.exec(value);
  return match?.[1] ? localInstant(match[1], Number(match[2]) * 60 + Number(match[3]), zone) : null;
}

/** How many started hours or started 24-hour periods a rental takes, as its price counts them. */
export function rentalUnits(
  priceUnit: RentalVehicle["priceUnit"],
  startsAt: string,
  endsAt: string,
): number {
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.ceil(duration / (priceUnit === "hour" ? 3_600_000 : 86_400_000));
}

/** The half hours of a day, "00:00" to "23:30"; a time between them is kept in its place. */
export function rentalTimes(keep?: string): string[] {
  const times = Array.from(
    { length: 48 },
    (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
  );
  if (keep && /^([01]\d|2[0-3]):[0-5]\d$/.test(keep) && !times.includes(keep)) {
    times.push(keep);
    times.sort();
  }
  return times;
}

/** What is offered first: from tomorrow at 09:00 until the day after at 09:00. */
export function rentalDefaults(today: string): { pickup: string; dropoff: string } {
  return { pickup: `${addDays(today, 1)}T09:00`, dropoff: `${addDays(today, 2)}T09:00` };
}

/**
 * Keeps the two moments in order when one of them is moved: a return at or before the new
 * pick-up moves to the same hour a day later.
 */
export function rentalWhen(
  current: { pickup: string; dropoff: string },
  change: Partial<{ pickup: string; dropoff: string }>,
): { pickup: string; dropoff: string } {
  const next = { ...current, ...change };
  if (change.pickup && next.pickup.length === 16 && next.dropoff <= next.pickup)
    next.dropoff = `${addDays(next.pickup.slice(0, 10), 1)}${next.pickup.slice(10)}`;
  return next;
}

/** "12.–14. 12.": a stretch of calendar days, short. */
export function dayRange(first: string, last: string, locale: Locale): string {
  const day = (value: string) => Number(value.slice(8));
  const month = (value: string) => Number(value.slice(5, 7));
  if (locale === "bs") {
    if (first === last) return `${day(first)}. ${month(first)}.`;
    return first.slice(0, 7) === last.slice(0, 7)
      ? `${day(first)}.–${day(last)}. ${month(last)}.`
      : `${day(first)}. ${month(first)}.–${day(last)}. ${month(last)}.`;
  }
  const format = new Intl.DateTimeFormat(`${intlLocale[locale]}-u-ca-gregory-nu-latn`, {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  });
  const date = (value: string) => new Date(`${value}T12:00:00Z`);
  return first === last
    ? format.format(date(first))
    : `${format.format(date(first))} – ${format.format(date(last))}`;
}

/**
 * The days a vehicle is already taken, from `today` on, in order and joined where they touch:
 * "2.–4. 12.". At most `limit` stretches are named; `more` says that others follow.
 */
export function takenDays(
  entries: readonly RentalInterval[],
  zone: string,
  today: string,
  locale: Locale = "bs",
  limit = 3,
): { periods: string[]; more: boolean } {
  const spans: { first: string; last: string }[] = [];
  for (const entry of entries) {
    const start = new Date(entry.startsAt);
    const end = new Date(Date.parse(entry.endsAt) - 1);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start)
      continue;
    try {
      const last = dateKey(end, zone);
      if (last < today) continue;
      const first = dateKey(start, zone);
      spans.push({ first: first < today ? today : first, last });
    } catch {
      // An interval that cannot be placed on this calendar says nothing about its days.
    }
  }
  spans.sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
  const joined: { first: string; last: string }[] = [];
  for (const span of spans) {
    const previous = joined.at(-1);
    if (previous && span.first <= addDays(previous.last, 1)) {
      if (span.last > previous.last) previous.last = span.last;
    } else joined.push({ ...span });
  }
  return {
    periods: joined.slice(0, limit).map((span) => dayRange(span.first, span.last, locale)),
    more: joined.length > limit,
  };
}
