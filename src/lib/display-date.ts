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
