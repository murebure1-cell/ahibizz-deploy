export class ConnectionsAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Connection action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new ConnectionsAccessError(status, code);
}
export function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  return input as Record<string, unknown>;
}
export function personId(input: unknown): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input))
    fail(400, "INVALID_CONNECTION_INPUT");
  return input;
}
export function uuid(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input)
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  return input.toLowerCase();
}
export function version(input: unknown, zero = false): number {
  if (
    !Number.isInteger(input) ||
    (input as number) < (zero ? 0 : 1) ||
    (input as number) > 2147483646
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  return input as number;
}
export function mediaVersion(input: unknown): number {
  if (!Number.isInteger(input) || (input as number) < 1 || (input as number) > 2147483647)
    fail(400, "INVALID_CONNECTION_INPUT");
  return input as number;
}
function page(input: unknown): number {
  if (input === undefined) return 1;
  if (!Number.isInteger(input) || (input as number) < 1 || (input as number) > 1000)
    fail(400, "INVALID_CONNECTION_INPUT");
  return input as number;
}
const searchStatuses = ["open_to_collaboration", "business_owner"] as const;
function unsafeText(text: string) {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);
    return (
      code < 32 ||
      code === 127 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}
export function searchInput(input: unknown) {
  const value = object(input, ["q", "page", "status", "city"]);
  if (
    value.status !== undefined &&
    !searchStatuses.includes(value.status as (typeof searchStatuses)[number])
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  if (
    value.city !== undefined &&
    (typeof value.city !== "string" ||
      !value.city.trim() ||
      value.city.trim().length > 100 ||
      unsafeText(value.city))
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  if (
    value.q !== undefined &&
    (typeof value.q !== "string" ||
      value.q.trim().length > 100 ||
      [...value.q].some((character) => {
        const code = character.charCodeAt(0);
        return (
          code < 32 ||
          code === 127 ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
        );
      }))
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  return {
    q: typeof value.q === "string" ? value.q.trim() : "",
    page: page(value.page),
    status: (value.status as (typeof searchStatuses)[number] | undefined) ?? null,
    city: typeof value.city === "string" ? value.city.trim() : null,
  };
}
export function listInput(input: unknown) {
  const value = object(input, ["view", "page"]);
  if (value.view !== "incoming" && value.view !== "outgoing" && value.view !== "contacts")
    fail(400, "INVALID_CONNECTION_INPUT");
  return { view: value.view, page: page(value.page) };
}
export function visibilityInput(input: unknown) {
  const value = object(input, ["isPublic", "expectedVersion"]);
  if (typeof value.isPublic !== "boolean") fail(400, "INVALID_CONNECTION_INPUT");
  return { isPublic: value.isPublic, expectedVersion: version(value.expectedVersion, true) };
}
export function requestInput(input: unknown) {
  const value = object(input, ["expectedVersion"]);
  return { expectedVersion: version(value.expectedVersion, true) };
}
export function transitionInput(input: unknown): {
  action: "accept" | "decline" | "cancel" | "remove";
  expectedVersion: number;
} {
  const value = object(input, ["action", "expectedVersion"]);
  if (
    value.action !== "accept" &&
    value.action !== "decline" &&
    value.action !== "cancel" &&
    value.action !== "remove"
  )
    fail(400, "INVALID_CONNECTION_INPUT");
  return { action: value.action, expectedVersion: version(value.expectedVersion) };
}
