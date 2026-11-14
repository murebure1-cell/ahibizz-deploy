import type {
  BookingAction,
  BookingListView,
  BookingSettingsInput,
  BookingWindow,
} from "../../lib/booking";
import { isTimeZone } from "../../lib/booking-time";

export class BookingAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Booking action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new BookingAccessError(status, code);
}
export function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_BOOKING_INPUT");
  return input as Record<string, unknown>;
}
export function uuid(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input)
  )
    fail(400, "INVALID_BOOKING_INPUT");
  return input.toLowerCase();
}
function integer(input: unknown, min: number, max: number): number {
  if (!Number.isInteger(input) || (input as number) < min || (input as number) > max)
    fail(400, "INVALID_BOOKING_INPUT");
  return input as number;
}
export function version(input: unknown, first = false): number {
  return integer(input, first ? 0 : 1, 2147483646);
}
export function text(input: unknown, max: number, nullable = false): string | null {
  if (nullable && (input === undefined || input === null || input === "")) return null;
  if (
    typeof input !== "string" ||
    input.trim().length < 1 ||
    input.trim().length > max ||
    [...input].some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        code === 127 ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    })
  )
    fail(400, "INVALID_BOOKING_INPUT");
  return input.trim();
}
export function instant(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input)
  )
    fail(400, "INVALID_BOOKING_INPUT");
  const date = new Date(input);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().replace(".000Z", "Z") !== input.replace(".000Z", "Z")
  )
    fail(400, "INVALID_BOOKING_INPUT");
  return date.toISOString();
}
export function settingsInput(input: unknown): BookingSettingsInput {
  const value = object(input, ["expectedVersion", "enabled", "timezone", "windows", "services"]);
  const expectedVersion = version(value.expectedVersion, true),
    timezone = text(value.timezone, 64) as string;
  if (
    typeof value.enabled !== "boolean" ||
    !isTimeZone(timezone) ||
    !Array.isArray(value.windows) ||
    value.windows.length > 28 ||
    !Array.isArray(value.services) ||
    value.services.length > 20
  )
    fail(400, "INVALID_BOOKING_INPUT");
  const windows: BookingWindow[] = value.windows
    .map((item) => {
      const row = object(item, ["weekday", "startMinute", "endMinute"]);
      const weekday = integer(row.weekday, 1, 7),
        startMinute = integer(row.startMinute, 0, 1439),
        endMinute = integer(row.endMinute, 1, 1440);
      if (endMinute <= startMinute) fail(400, "INVALID_BOOKING_INPUT");
      return { weekday, startMinute, endMinute };
    })
    .sort(
      (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute || a.endMinute - b.endMinute,
    );
  for (let i = 1; i < windows.length; i++) {
    const prior = windows[i - 1],
      current = windows[i];
    if (
      prior &&
      current &&
      prior.weekday === current.weekday &&
      prior.endMinute > current.startMinute
    )
      fail(400, "INVALID_BOOKING_INPUT");
  }
  const seen = new Set<string>();
  const services = value.services.map((item) => {
    const row = object(item, ["id", "name", "durationMinutes", "priceMinor", "active"]);
    const id = row.id === undefined ? undefined : uuid(row.id),
      name = text(row.name, 120) as string;
    if (id && seen.has(id)) fail(400, "INVALID_BOOKING_INPUT");
    if (id) seen.add(id);
    const durationMinutes = integer(row.durationMinutes, 15, 240),
      priceMinor = integer(row.priceMinor, 0, 10000000);
    if (durationMinutes % 5 !== 0 || typeof row.active !== "boolean")
      fail(400, "INVALID_BOOKING_INPUT");
    return { ...(id ? { id } : {}), name, durationMinutes, priceMinor, active: row.active };
  });
  return { expectedVersion, enabled: value.enabled, timezone, windows, services };
}
export function slotInput(input: unknown) {
  const value = object(input, ["serviceId", "date"]);
  if (
    typeof value.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    !Number.isFinite(Date.parse(`${value.date}T00:00:00.000Z`)) ||
    new Date(`${value.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== value.date
  )
    fail(400, "INVALID_BOOKING_INPUT");
  return { serviceId: uuid(value.serviceId), date: value.date };
}
export function requestInput(input: unknown) {
  const value = object(input, ["serviceId", "startsAt", "configurationVersion"]);
  return {
    serviceId: uuid(value.serviceId),
    startsAt: instant(value.startsAt),
    configurationVersion: version(value.configurationVersion),
  };
}
export function manualInput(input: unknown) {
  const value = object(input, [
    "kind",
    "serviceId",
    "startsAt",
    "endsAt",
    "clientName",
    "clientPhone",
  ]);
  if (value.kind !== "manual" && value.kind !== "block") fail(400, "INVALID_BOOKING_INPUT");
  const serviceId =
    value.serviceId === undefined || value.serviceId === null ? null : uuid(value.serviceId);
  if ((value.kind === "manual" && !serviceId) || (value.kind === "block" && serviceId))
    fail(400, "INVALID_BOOKING_INPUT");
  const clientPhone = text(value.clientPhone, 40, true);
  if (clientPhone && !/^[+0-9][0-9 ().-]{3,39}$/.test(clientPhone))
    fail(400, "INVALID_BOOKING_INPUT");
  return {
    kind: value.kind as "manual" | "block",
    serviceId,
    startsAt: instant(value.startsAt),
    endsAt: value.endsAt === undefined ? null : instant(value.endsAt),
    clientName: text(value.clientName, 120, true),
    clientPhone,
  };
}
export function transitionInput(input: unknown) {
  const value = object(input, ["expectedVersion", "action"]);
  if (!["approve", "decline", "cancel", "complete"].includes(value.action as string))
    fail(400, "INVALID_BOOKING_INPUT");
  return { expectedVersion: version(value.expectedVersion), action: value.action as BookingAction };
}
export function rangeInput(input: unknown) {
  const value = object(input, ["from", "to"]),
    from = instant(value.from),
    to = instant(value.to);
  const length = Date.parse(to) - Date.parse(from);
  if (length <= 0 || length > 32 * 86400000) fail(400, "INVALID_BOOKING_INPUT");
  return { from, to };
}
export function mineInput(input: unknown = {}) {
  const value = object(input, ["page", "view"]);
  if (value.view !== undefined && value.view !== "upcoming" && value.view !== "history")
    fail(400, "INVALID_BOOKING_INPUT");
  return {
    page: integer(value.page ?? 1, 1, 500),
    view: value.view as BookingListView | undefined,
  };
}
