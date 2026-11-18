import {
  RENTAL_BRANDS,
  type RentalDecisionInput,
  type RentalRequestInput,
  type RentalVehicleInput,
} from "../../lib/rentals";
import { AccountAccessError } from "../auth/accounts";

export function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}
export function uuid(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    fail(400, "INVALID_RENTAL_INPUT");
  return v.toLowerCase();
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    v === null ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_RENTAL_INPUT");
  return v as Record<string, unknown>;
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    fail(400, "INVALID_RENTAL_INPUT");
  return v;
}
function text(v: unknown, max: number): string {
  if (typeof v !== "string" || /\p{Cc}/u.test(v) || v.trim().length < 1 || v.trim().length > max)
    fail(400, "INVALID_RENTAL_INPUT");
  return v.trim();
}
function option<const T extends readonly string[]>(v: unknown, choices: T): T[number] {
  if (typeof v !== "string" || !choices.includes(v)) fail(400, "INVALID_RENTAL_INPUT");
  return v;
}
export function vehicleInput(v: unknown): RentalVehicleInput {
  const a = object(v, [
    "id",
    "expectedVersion",
    "name",
    "brand",
    "model",
    "year",
    "seats",
    "fuel",
    "transmission",
    "description",
    "photoSlot",
    "priceMinor",
    "priceUnit",
    "enabled",
  ]);
  if (typeof a.enabled !== "boolean") fail(400, "INVALID_RENTAL_INPUT");
  const expectedVersion = integer(a.expectedVersion, 0, 2147483646);
  if (expectedVersion > 0 && !a.id) fail(400, "INVALID_RENTAL_INPUT");
  return {
    ...(a.id !== undefined ? { id: uuid(a.id) } : {}),
    expectedVersion,
    name: text(a.name, 100),
    brand: option(a.brand, RENTAL_BRANDS),
    model: text(a.model, 80),
    year: a.year == null ? null : integer(a.year, 1886, new Date().getUTCFullYear() + 2),
    seats: integer(a.seats, 1, 99),
    fuel: option(a.fuel, ["petrol", "diesel", "hybrid", "electric"]),
    transmission: option(a.transmission, ["manual", "automatic"]),
    description: a.description == null || a.description === "" ? null : text(a.description, 1000),
    ...(a.photoSlot === undefined
      ? {}
      : { photoSlot: a.photoSlot === null ? null : integer(a.photoSlot, 1, 8) }),
    priceMinor: integer(a.priceMinor, 0, 10000000),
    priceUnit: option(a.priceUnit, ["hour", "day"]),
    enabled: a.enabled,
  };
}
export function versionInput(v: unknown): number {
  return integer(object(v, ["expectedVersion"]).expectedVersion, 1, 2147483646);
}
export function interval(from: unknown, to: unknown, calendarWindow = false) {
  function instant(v: unknown): string {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.000)?)?Z$/.test(v))
      fail(400, "INVALID_RENTAL_INTERVAL");
    const date = new Date(v);
    if (
      v.startsWith("0000") ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 16) !== v.slice(0, 16)
    )
      fail(400, "INVALID_RENTAL_INTERVAL");
    return date.toISOString();
  }
  const startsAt = instant(from),
    endsAt = instant(to);
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  if (duration <= 0 || (calendarWindow && duration > 366 * 86_400_000))
    fail(400, "INVALID_RENTAL_INTERVAL");
  return { startsAt, endsAt };
}
export function requestInput(v: unknown): RentalRequestInput {
  const a = object(v, ["requestId", "expectedVehicleVersion", "startsAt", "endsAt"]);
  return {
    ...interval(a.startsAt, a.endsAt),
    requestId: uuid(a.requestId),
    expectedVehicleVersion: integer(a.expectedVehicleVersion, 1, 2147483647),
  };
}
export function decisionInput(v: unknown): RentalDecisionInput {
  const a = object(v, ["action", "expectedVersion"]);
  return {
    action: option(a.action, ["approve", "decline", "cancel"]),
    expectedVersion: integer(a.expectedVersion, 1, 2147483646),
  };
}
