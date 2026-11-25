import { intlLocale, type Locale } from "./i18n/locales";

const defaultTimeZone = "Europe/Sarajevo";

/** Stable Bosnian presentation, independent of the browser locale and timezone. */
export function accountDate(value: string | Date, timeZone = defaultTimeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB-u-nu-latn", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}. ${parts.month}. ${parts.year}.`;
}

export function bosnianDateTime(value: string | Date, timeZone = defaultTimeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const time = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
  return `${accountDate(date, timeZone)} ${time}`;
}

/** Date in the reader's interface language; Bosnian keeps the stable form above. */
export function localDate(value: string | Date, locale: Locale, timeZone = defaultTimeZone) {
  if (locale === "bs") return accountDate(value, timeZone);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-nu-latn`, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(date);
}

/** The calendar day of a moment in a time zone, as a number that grows by one a day. */
function dayNumber(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB-u-nu-latn", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      weekday: "short",
      timeZone,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? ""),
    number: Math.round(Date.UTC(year, month - 1, day) / 86_400_000),
  };
}

const bosnianWeekdays = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"];

/**
 * A moment told as shortly as a list allows, counted in whole calendar days back from `now`:
 * today is "danas" (or the time, which the caller shows instead), yesterday "jučer", the last
 * week a weekday, this year day and month, and before that the whole date. `heading` asks for
 * the form that stands alone over a day of messages: "Danas", "Jučer" or the whole date.
 */
export function recentDay(
  value: string | Date,
  now: Date,
  locale: Locale,
  { heading = false, timeZone = defaultTimeZone }: { heading?: boolean; timeZone?: string } = {},
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const then = dayNumber(date, timeZone);
  const today = dayNumber(now, timeZone);
  const back = today.number - then.number;
  const tag = `${intlLocale[locale]}-u-nu-latn`;
  if (back === 0 || back === 1) {
    // Bosnian words are written here: not every browser carries Bosnian date data.
    const word =
      locale === "bs"
        ? back === 0
          ? "danas"
          : "jučer"
        : new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(-back, "day");
    return heading ? word.charAt(0).toLocaleUpperCase(intlLocale[locale]) + word.slice(1) : word;
  }
  if (heading) return localDate(date, locale, timeZone);
  if (back > 1 && back < 7)
    return locale === "bs"
      ? (bosnianWeekdays[then.weekday] ?? accountDate(date, timeZone))
      : new Intl.DateTimeFormat(tag, { weekday: "short", timeZone }).format(date);
  if (then.year === today.year)
    return locale === "bs"
      ? `${then.day}. ${then.month}.`
      : new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone }).format(date);
  return localDate(date, locale, timeZone);
}

export function localDateTime(value: string | Date, locale: Locale, timeZone = defaultTimeZone) {
  if (locale === "bs") return bosnianDateTime(value, timeZone);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-nu-latn`, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: locale === "en" ? "h12" : "h23",
    timeZone,
  }).format(date);
}
