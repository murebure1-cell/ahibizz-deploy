import { intlLocale, type Locale } from "./i18n/locales";
import { msg } from "./i18n/translate";

export type BookingWindow = { weekday: number; startMinute: number; endMinute: number };
export type BookingServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
  active: boolean;
};
export type BookingServiceInput = Omit<BookingServiceOption, "id"> & { id?: string };
export type BookingSettings = {
  enabled: boolean;
  timezone: string;
  version: number;
  windows: BookingWindow[];
  services: BookingServiceOption[];
};
export type BookingSettingsInput = Omit<BookingSettings, "version" | "services"> & {
  expectedVersion: number;
  services: BookingServiceInput[];
};
export type PublicBookingConfiguration = {
  enabled: boolean;
  timezone: string;
  version: number;
  services: Omit<BookingServiceOption, "active">[];
};
export type BookingSlot = { startsAt: string; endsAt: string };
export type BookingStatus = "requested" | "confirmed" | "cancelled" | "completed" | "declined";
export type BookingKind = "customer" | "manual" | "block";
export type BookingAction = "approve" | "decline" | "cancel" | "complete";
export type BookingListView = "upcoming" | "history";
export type BookingEntry = BookingSlot & {
  id: string;
  businessId: string;
  businessTitle: string;
  timezone: string;
  kind: BookingKind;
  serviceId: string | null;
  serviceName: string | null;
  durationMinutes: number | null;
  priceMinor: number;
  status: BookingStatus;
  version: number;
  customerId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
};
export const bookingStatusLabels: Record<BookingStatus, string> = {
  requested: msg("Čeka odobrenje"),
  confirmed: msg("Potvrđen"),
  cancelled: msg("Otkazan"),
  completed: msg("Održan"),
  declined: msg("Odbijen"),
};
/** Active appointments remain current until their exact end, including an appointment in progress. */
export function bookingIsUpcoming(
  entry: Pick<BookingEntry, "status" | "endsAt">,
  asOf: number,
): boolean {
  return (
    (entry.status === "requested" || entry.status === "confirmed") &&
    Date.parse(entry.endsAt) > asOf
  );
}
const bookingMonths = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "August",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

export function bookingMoney(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return "—";
  const whole = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${String(minor % 100).padStart(2, "0")} KM`;
}

export function bookingMonth(value: string, locale: Locale = "bs"): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) || value.startsWith("0000")) return "—";
  if (locale !== "bs")
    return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-ca-gregory-nu-latn`, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}-15T12:00:00Z`));
  return `${bookingMonths[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}`;
}

const bookingShortDays = ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"] as const;

/** "Čet" for a calendar day written as YYYY-MM-DD. */
export function bookingShortDay(day: string, locale: Locale = "bs"): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime())) return "—";
  if (locale === "bs") return bookingShortDays[(date.getUTCDay() + 6) % 7] ?? "—";
  return new Intl.DateTimeFormat(intlLocale[locale], { weekday: "short", timeZone: "UTC" }).format(
    date,
  );
}

/** "Čet 26. 11." for a calendar day written as YYYY-MM-DD. */
export function bookingShortDate(day: string, locale: Locale = "bs"): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime())) return "—";
  if (locale === "bs")
    return `${bookingShortDay(day)} ${Number(day.slice(8))}. ${Number(day.slice(5, 7))}.`;
  return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-ca-gregory-nu-latn`, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** One-letter weekday names from Monday, as calendars show them. */
export function bookingWeekdays(locale: Locale = "bs"): string[] {
  if (locale === "bs") return ["P", "U", "S", "Č", "P", "S", "N"];
  const format = new Intl.DateTimeFormat(intlLocale[locale], {
    weekday: "narrow",
    timeZone: "UTC",
  });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(Date.UTC(2024, 0, 1 + day))));
}

export function bookingDate(
  iso: string,
  timezone: string,
  { time = false, locale = "bs" }: { time?: boolean; locale?: Locale } = {},
): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    if (locale !== "bs")
      return new Intl.DateTimeFormat(`${intlLocale[locale]}-u-ca-gregory-nu-latn`, {
        timeZone: timezone,
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(time
          ? { hour: "2-digit" as const, minute: "2-digit" as const, hourCycle: "h23" as const }
          : {}),
      }).format(date);
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(time
          ? { hour: "2-digit" as const, minute: "2-digit" as const, hourCycle: "h23" as const }
          : {}),
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    const label = `${values.day}. ${values.month}. ${values.year}.`;
    return time ? `${label} u ${values.hour}:${values.minute}` : label;
  } catch {
    return "—";
  }
}
