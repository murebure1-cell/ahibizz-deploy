export class BusinessMediaAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Business image action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new BusinessMediaAccessError(status, code);
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(400, "INVALID_BUSINESS_MEDIA_INPUT");
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  )
    fail(400, "INVALID_BUSINESS_MEDIA_INPUT");
  return value.toLowerCase();
}
export function kindSlot(
  kind: unknown,
  slot: unknown,
): { kind: "logo" | "cover" | "gallery"; slot: number } {
  if (
    !["logo", "cover", "gallery"].includes(String(kind)) ||
    typeof kind !== "string" ||
    !Number.isInteger(slot) ||
    (kind === "gallery" ? (slot as number) < 1 || (slot as number) > 8 : slot !== 0)
  )
    fail(400, "INVALID_BUSINESS_MEDIA_INPUT");
  return { kind: kind as "logo" | "cover" | "gallery", slot: slot as number };
}
export function version(value: unknown, maximum = 2147483646): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum)
    fail(400, "INVALID_BUSINESS_MEDIA_INPUT");
  return value as number;
}
