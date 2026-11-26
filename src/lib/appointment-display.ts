import { bookingShortDay } from "./booking";
import { dateKey } from "./booking-time";
import { intlLocale, type Locale } from "./i18n/locales";

const calendarDay = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone, or null when unreadable. */
export function appointmentDay(iso: string, timezone: string): string | null {
  try {
    return dateKey(new Date(iso), timezone);
  } catch {
    return null;
  }
}

/** What stands in the tile of an appointment: the short weekday and the day of the month. */
export function appointmentTile(day: string | null, locale: Locale = "bs") {
  if (!day || !calendarDay.test(day)) return { weekday: "—", number: "—" };
  return { weekday: bookingShortDay(day, locale), number: String(Number(day.slice(8))) };
}

/** "10:00" for an instant on the clock of a time zone. */
export function appointmentClock(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB-u-nu-latn", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(date);
  } catch {
    return "—";
  }
}

/**
 * A calendar day as it stands inside a line of text: "ned 29. 11." in Bosnian, written by hand;
 * other languages use their own short names. The year is said only when it is not `year`.
 */
export function appointmentDate(day: string | null, locale: Locale = "bs", year?: string): string {
  if (!day || !calendarDay.test(day)) return "—";
  const otherYear = year !== undefined && day.slice(0, 4) !== year;
  if (locale === "bs") {
    const date = `${bookingShortDay(day).toLowerCase()} ${Number(day.slice(8))}. ${Number(day.slice(5, 7))}.`;
    return otherYear ? `${date} ${day.slice(0, 4)}.` : date;
  }
  return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-ca-gregory-nu-latn`, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    ...(otherYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** A day with its hour inside a line of text: "ned 29. 11. u 09:00". */
export function appointmentMoment(
  iso: string,
  timezone: string,
  locale: Locale = "bs",
  year?: string,
): string {
  const day = appointmentDay(iso, timezone);
  if (!day) return "—";
  const clock = appointmentClock(iso, timezone);
  if (locale === "bs") return `${appointmentDate(day, locale, year)} u ${clock}`;
  return `${appointmentDate(day, locale, year)}, ${clock}`;
}

/**
 * Whether a day lies outside the month of `today`. The tile of a card carries only the weekday
 * and the day of the month, so such a day must also be said in the line beside it.
 */
export function outsideThisMonth(day: string | null, today: string | null): boolean {
  return Boolean(day && today && day.slice(0, 7) !== today.slice(0, 7));
}

/**
 * When a service appointment takes place, for the line under its name: "10:00–11:00", or
 * "sub 12. 12. · 10:00–11:00" outside the month of `today`.
 */
export function appointmentHours(
  entry: { startsAt: string; endsAt: string; timezone: string },
  today: string | null,
  locale: Locale = "bs",
): string {
  const hours = `${appointmentClock(entry.startsAt, entry.timezone)}–${appointmentClock(entry.endsAt, entry.timezone)}`;
  const day = appointmentDay(entry.startsAt, entry.timezone);
  if (!outsideThisMonth(day, today)) return hours;
  return `${appointmentDate(day, locale, today?.slice(0, 4))} · ${hours}`;
}

/**
 * From when until when a vehicle is taken: "09:00 – ned 29. 11. u 09:00". The tile says the day
 * of taking it over, unless that day is outside the month of `today`.
 */
export function rentalSpan(
  entry: { startsAt: string; endsAt: string; timezone: string },
  today: string | null,
  locale: Locale = "bs",
): string {
  const year = today?.slice(0, 4);
  const from = outsideThisMonth(appointmentDay(entry.startsAt, entry.timezone), today)
    ? appointmentMoment(entry.startsAt, entry.timezone, locale, year)
    : appointmentClock(entry.startsAt, entry.timezone);
  return `${from} – ${appointmentMoment(entry.endsAt, entry.timezone, locale, year)}`;
}
