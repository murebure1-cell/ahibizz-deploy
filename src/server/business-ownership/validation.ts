import type { OwnershipCommand } from "../../lib/business-ownership";

export class OwnershipAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Business ownership action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new OwnershipAccessError(status, code);
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    fail(400, "INVALID_OWNERSHIP_INPUT");
  return value.toLowerCase();
}
export function accountId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    fail(400, "INVALID_OWNERSHIP_INPUT");
  return value;
}
export function email(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    /[\p{Cc}\p{Cf}<>]/u.test(value) ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim())
  )
    fail(400, "INVALID_OWNERSHIP_INPUT");
  return value.trim().toLowerCase();
}
function object(input: unknown, keys: string[]) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_OWNERSHIP_INPUT");
  return input as Record<string, unknown>;
}
export function lookupInput(input: unknown): string {
  return email(object(input, ["email"]).email);
}
export function commandInput(input: unknown): OwnershipCommand & { note: string } {
  const value = object(input, [
    "expectedVersion",
    "targetAccountId",
    "targetEmail",
    "idempotencyKey",
    "note",
  ]);
  if (
    !Number.isInteger(value.expectedVersion) ||
    (value.expectedVersion as number) < 1 ||
    (value.expectedVersion as number) > 2147483646
  )
    fail(400, "INVALID_OWNERSHIP_INPUT");
  const note = value.note === undefined ? "" : value.note;
  if (typeof note !== "string" || note.length > 500 || /[\p{Cc}\p{Cf}<>]/u.test(note))
    fail(400, "INVALID_OWNERSHIP_INPUT");
  return {
    expectedVersion: value.expectedVersion as number,
    targetAccountId: accountId(value.targetAccountId),
    targetEmail: email(value.targetEmail),
    idempotencyKey: uuid(value.idempotencyKey),
    note: note.trim(),
  };
}
