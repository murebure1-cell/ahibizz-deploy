import { isTimeZone } from "./booking-time";
import { msg } from "./i18n/translate";

export const businessAmenities = [
  { id: "wifi", label: msg("Wi-Fi"), icon: "wifi" },
  { id: "parking", label: msg("Parking"), icon: "parking" },
  { id: "accessible", label: msg("Pristupačan ulaz"), icon: "accessible" },
  { id: "pets", label: msg("Kućni ljubimci"), icon: "pets" },
  { id: "card-payment", label: msg("Kartično plaćanje"), icon: "payment" },
  { id: "family", label: msg("Za porodice"), icon: "family" },
] as const;
export type BusinessAmenityId = (typeof businessAmenities)[number]["id"];
export type BusinessHoursDay = {
  weekday: number;
  windows: { startMinute: number; endMinute: number }[];
};
export type BusinessDetails = {
  timezone: string | null;
  hours: BusinessHoursDay[] | null;
  amenities: BusinessAmenityId[];
};
export const businessWeekdays = [
  msg("Ponedjeljak"),
  msg("Utorak"),
  msg("Srijeda"),
  msg("Četvrtak"),
  msg("Petak"),
  msg("Subota"),
  msg("Nedjelja"),
] as const;

export function emptyBusinessDetails(): BusinessDetails {
  return { timezone: null, hours: null, amenities: [] };
}
function record(input: unknown, keys: string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw new Error("INVALID_BUSINESS_DETAILS");
  return input as Record<string, unknown>;
}
/** A complete opted-in week is explicit: no windows means closed, null means unknown. */
export function readBusinessDetails(input: unknown): BusinessDetails {
  const value = record(input, ["timezone", "hours", "amenities"]);
  if (
    !Array.isArray(value.amenities) ||
    value.amenities.length > businessAmenities.length ||
    value.amenities.some((id) => !businessAmenities.some((entry) => entry.id === id)) ||
    new Set(value.amenities).size !== value.amenities.length
  )
    throw new Error("INVALID_BUSINESS_DETAILS");
  const selected = value.amenities as unknown[];
  const amenities = businessAmenities.flatMap((entry) =>
    selected.includes(entry.id) ? [entry.id] : [],
  );
  if (value.hours === null && value.timezone === null)
    return { timezone: null, hours: null, amenities };
  if (!isTimeZone(value.timezone) || !Array.isArray(value.hours) || value.hours.length !== 7)
    throw new Error("INVALID_BUSINESS_DETAILS");
  const hours = value.hours.map((raw, index) => {
    const day = record(raw, ["weekday", "windows"]);
    if (day.weekday !== index + 1 || !Array.isArray(day.windows) || day.windows.length > 4)
      throw new Error("INVALID_BUSINESS_DETAILS");
    let end = -1;
    const windows = day.windows.map((rawWindow) => {
      const window = record(rawWindow, ["startMinute", "endMinute"]);
      const startMinute = window.startMinute as number,
        endMinute = window.endMinute as number;
      if (
        !Number.isInteger(startMinute) ||
        !Number.isInteger(endMinute) ||
        startMinute < 0 ||
        endMinute > 1440 ||
        startMinute >= endMinute ||
        startMinute < end
      )
        throw new Error("INVALID_BUSINESS_DETAILS");
      end = endMinute;
      return { startMinute, endMinute };
    });
    return { weekday: index + 1, windows };
  });
  return { timezone: value.timezone, hours, amenities };
}

export function businessTimeLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The opening window that contains `now`: null when closed, undefined when it cannot be told.
    The real instant is converted into the business's local wall time, including DST folds/gaps. */
function currentWindow(
  details: BusinessDetails | null | undefined,
  now: Date,
): BusinessHoursDay["windows"][number] | null | undefined {
  if (!details?.hours || !details.timezone || !Number.isFinite(now.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
      timeZone: details.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekday =
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(values.weekday ?? "") + 1;
    const minute = Number(values.hour) * 60 + Number(values.minute);
    const day = details.hours.find((entry) => entry.weekday === weekday);
    if (!day || !Number.isInteger(minute)) return undefined;
    return (
      day.windows.find((window) => window.startMinute <= minute && minute < window.endMinute) ??
      null
    );
  } catch {
    return undefined;
  }
}
export function businessOpenState(
  details: BusinessDetails | null | undefined,
  now: Date,
): "open" | "closed" | null {
  const window = currentWindow(details, now);
  return window === undefined ? null : window ? "open" : "closed";
}
/** When open, the minute of the day at which today's current window ends; otherwise null. A
    window that runs to midnight returns null, because the next day may continue it. */
export function businessClosingMinute(
  details: BusinessDetails | null | undefined,
  now: Date,
): number | null {
  const window = currentWindow(details, now);
  return window && window.endMinute < 1440 ? window.endMinute : null;
}
