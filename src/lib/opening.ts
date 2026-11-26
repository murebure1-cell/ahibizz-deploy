import { businessLocalTime } from "./business-details";
import { intlLocale, type Locale } from "./i18n/locales";
import { bosnianForm, msg } from "./i18n/translate";

/**
 * The moment the app opens to everyone, as a full instant with its offset, for example
 * "2026-12-02T12:00:00+01:00". Until then a visitor who is not signed in is sent from the public
 * pages to the page "Uskoro otvaramo"; people with an account sign in and use the app as usual.
 * `null` means there is no such page: the app is open.
 *
 * The server setting AHIBIZZ_OPENING_AT, when it holds such an instant, takes the place of this
 * value without a new build; "off" there switches the page off.
 *
 * The owner's decision of 2026-11-26: Friday 4 December 2026, after the Friday prayer. The hour
 * is ours: 13:00 in Sarajevo, when the prayer is over everywhere in Bosnia and Herzegovina.
 */
export const openingAt: string | null = "2026-12-04T13:00:00+01:00";

const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

/** An instant written in full, as milliseconds; null for anything else. */
export function readOpening(value: string | null | undefined): number | null {
  const text = value?.trim() ?? "";
  if (!instant.test(text)) return null;
  const moment = Date.parse(text);
  return Number.isFinite(moment) ? moment : null;
}

/** The moment of opening: the server setting when it gives one, otherwise the value kept here. */
export function openingMoment(
  setting: string | null | undefined,
  kept: string | null = openingAt,
): number | null {
  if (setting?.trim().toLowerCase() === "off") return null;
  return readOpening(setting) ?? readOpening(kept);
}

/** Whether the opening is still ahead at `now`. */
export function beforeOpening(moment: number | null, now: number): moment is number {
  return moment !== null && now < moment;
}

/** The address of the page. It carries where the visitor was going as "od". */
export const openingPath = "/uskoro";

/**
 * What a visitor without an account still reaches before the opening: signing in and joining,
 * the pages that send a guest to sign in on their own, the texts a registration links to, the
 * instructions for deleting an account (they must stay public), and the choice of language.
 */
const openPaths = [
  "/prijava",
  "/registracija",
  "/zaboravljena-lozinka",
  "/nova-lozinka",
  "/nalog",
  "/administracija",
  "/sadrzaj",
  "/privatnost",
  "/pravila-zajednice",
  "/brisanje-naloga",
  "/jezik",
  "/store-unavailable",
  openingPath,
];

export function openBeforeOpening(pathname: string): boolean {
  return openPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * A path on this site to go on to, or null: never another site, never the page itself. Only as a
 * browser writes an address, in plain printable characters, because the server puts it in a
 * redirect once the day has come.
 */
export function returnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  if (!/^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/.test(value)) return null;
  const path = value.split(/[?#]/)[0] ?? "";
  return path === "/" || path === openingPath || path.startsWith(`${openingPath}/`) ? null : value;
}

/** What is left until the opening, in whole days, hours, minutes and seconds. */
export function countdownParts(seconds: number) {
  const left = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return {
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}

/**
 * The word under a number of days or hours. The number stands above it, so the text is the
 * word alone; each translation still needs the count to pick its own form.
 */
export function dayWord(count: number) {
  return bosnianForm(
    count,
    msg("{count|dan|dan}"),
    msg("{count|dana|dana}"),
    msg("{count|dana|dana}"),
  );
}
export function hourWord(count: number) {
  return bosnianForm(
    count,
    msg("{count|sat|sat}"),
    msg("{count|sata|sata}"),
    msg("{count|sati|sati}"),
  );
}

const onBosnianDay = [
  "u ponedjeljak",
  "u utorak",
  "u srijedu",
  "u četvrtak",
  "u petak",
  "u subotu",
  "u nedjelju",
];

/**
 * The day and the hour of the opening on the clock of Sarajevo, as it stands in a sentence:
 * "u srijedu, 2. 12. 2026. u 12:00". Bosnian is written by hand; other languages use their own
 * names of days and months.
 */
export function openingWhen(moment: number, locale: Locale = "bs"): string {
  const timeZone = "Europe/Sarajevo";
  const date = new Date(moment);
  if (!Number.isFinite(date.getTime())) return "—";
  if (locale !== "bs")
    return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-ca-gregory-nu-latn`, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: locale === "en" ? "h12" : "h23",
      timeZone,
    }).format(date);
  const local = businessLocalTime(timeZone, date);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      timeZone,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  if (!local) return "—";
  const clock = `${String(Math.floor(local.minute / 60)).padStart(2, "0")}:${String(local.minute % 60).padStart(2, "0")}`;
  // The day and the month stand without a leading zero, whatever the formatter pads.
  return `${onBosnianDay[local.weekday - 1]}, ${Number(parts.day)}. ${Number(parts.month)}. ${parts.year}. u ${clock}`;
}
