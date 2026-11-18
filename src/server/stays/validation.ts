import {
  type StayDecisionInput,
  type StayRequestInput,
  type StayUnitInput,
  stayNights,
} from "../../lib/stays";
import { AccountAccessError } from "../auth/accounts";

export function fail(status: number, code: string): never {
  throw new AccountAccessError(status, code);
}
function invalid(): never {
  return fail(400, "INVALID_STAY_INPUT");
}
export function uuid(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid();
  return value.toLowerCase();
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    invalid();
  return value;
}
function text(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    /\p{Cc}/u.test(value) ||
    !value.trim() ||
    value.trim().length > max
  )
    invalid();
  return value.trim();
}
export function unitInput(input: unknown): StayUnitInput {
  const v = object(input, [
    "id",
    "expectedVersion",
    "name",
    "type",
    "beds",
    "description",
    "photoSlots",
    "priceMinor",
    "enabled",
  ]);
  const expectedVersion = integer(v.expectedVersion, 0, 2147483646);
  if (
    (expectedVersion > 0 && !v.id) ||
    (v.type !== "room" && v.type !== "apartment") ||
    typeof v.enabled !== "boolean"
  )
    invalid();
  let photos: number[] | undefined;
  if (v.photoSlots !== undefined) {
    if (
      !Array.isArray(v.photoSlots) ||
      v.photoSlots.length > 8 ||
      v.photoSlots.some((s) => typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 8) ||
      new Set(v.photoSlots).size !== v.photoSlots.length
    )
      fail(400, "INVALID_STAY_PHOTO");
    photos = v.photoSlots;
  }
  return {
    ...(v.id === undefined ? {} : { id: uuid(v.id) }),
    expectedVersion,
    name: text(v.name, 100),
    type: v.type,
    beds: integer(v.beds, 1, 99),
    description: v.description == null || v.description === "" ? null : text(v.description, 1000),
    ...(photos === undefined ? {} : { photoSlots: photos }),
    priceMinor: integer(v.priceMinor, 0, 10000000),
    enabled: v.enabled,
  };
}
export function versionInput(input: unknown) {
  return integer(object(input, ["expectedVersion"]).expectedVersion, 1, 2147483646);
}
function localDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    fail(400, "INVALID_STAY_INTERVAL");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    fail(400, "INVALID_STAY_INTERVAL");
  return value;
}
export function interval(from: unknown, to: unknown, calendarWindow = false) {
  const checkIn = localDate(from),
    checkOut = localDate(to);
  if (checkOut <= checkIn || (calendarWindow && stayNights(checkIn, checkOut) > 366))
    fail(400, "INVALID_STAY_INTERVAL");
  return { checkIn, checkOut };
}
export function requestInput(input: unknown): StayRequestInput {
  const v = object(input, ["checkIn", "checkOut", "requestId", "expectedUnitVersion"]);
  return {
    ...interval(v.checkIn, v.checkOut),
    requestId: uuid(v.requestId),
    expectedUnitVersion: integer(v.expectedUnitVersion, 1, 2147483647),
  };
}
export function decisionInput(input: unknown): StayDecisionInput {
  const v = object(input, ["action", "expectedVersion"]);
  if (v.action !== "approve" && v.action !== "decline" && v.action !== "cancel") invalid();
  return { action: v.action, expectedVersion: integer(v.expectedVersion, 1, 2147483646) };
}
