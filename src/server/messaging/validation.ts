import { normalizeMessageBody } from "../../lib/messaging";

export class MessagingAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Messaging action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new MessagingAccessError(status, code);
}
export function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_MESSAGING_INPUT");
  return input as Record<string, unknown>;
}
export function uuid(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input)
  )
    fail(400, "INVALID_MESSAGING_INPUT");
  return input.toLowerCase();
}
export function personId(input: unknown): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input))
    fail(400, "INVALID_MESSAGING_INPUT");
  return input;
}
export function integer(input: unknown, min = 0, max = 2147483646): number {
  if (!Number.isInteger(input) || (input as number) < min || (input as number) > max)
    fail(400, "INVALID_MESSAGING_INPUT");
  return input as number;
}
export function openInput(input: unknown) {
  const row = object(input, ["kind", "targetId"]);
  if (row.kind !== "person" && row.kind !== "business") fail(400, "INVALID_MESSAGING_INPUT");
  return {
    kind: row.kind,
    targetId: row.kind === "business" ? uuid(row.targetId) : personId(row.targetId),
  };
}
export function listInput(input: unknown) {
  const row = object(input, ["inbox", "page"]);
  if (row.inbox !== "personal" && row.inbox !== "business") fail(400, "INVALID_MESSAGING_INPUT");
  return { inbox: row.inbox, page: row.page === undefined ? 1 : integer(row.page, 1, 1000) };
}
export function readInput(input: unknown) {
  const row = object(input, ["before"]);
  return { before: row.before === undefined ? undefined : integer(row.before, 1) };
}
export function sendInput(input: unknown) {
  const row = object(input, ["body"]);
  try {
    return { body: normalizeMessageBody(row.body) };
  } catch {
    fail(400, "INVALID_MESSAGING_INPUT");
  }
}
export function readMarkInput(input: unknown) {
  const row = object(input, ["throughSequence"]);
  return { throughSequence: integer(row.throughSequence) };
}
export function blockInput(input: unknown) {
  const row = object(input, ["blocked"]);
  if (typeof row.blocked !== "boolean") fail(400, "INVALID_MESSAGING_INPUT");
  return { blocked: row.blocked };
}
