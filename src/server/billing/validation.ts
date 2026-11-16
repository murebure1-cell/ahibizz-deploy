import type { BillingAdjustmentInput, BillingReceiptInput } from "../../lib/billing";

export class BillingAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Billing operation could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new BillingAccessError(status, code);
}
export function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    fail(400, "INVALID_BILLING_INPUT");
  return input as Record<string, unknown>;
}
export function uuid(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input)
  )
    fail(400, "INVALID_BILLING_INPUT");
  return input.toLowerCase();
}
export function integer(input: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < min || (input as number) > max)
    fail(400, "INVALID_BILLING_INPUT");
  return input as number;
}
export function text(input: unknown, max: number, min = 1): string {
  if (
    typeof input !== "string" ||
    input.trim().length < min ||
    input.trim().length > max ||
    /[\p{Cc}\p{Cf}]/u.test(input)
  )
    fail(400, "INVALID_BILLING_INPUT");
  return input.trim();
}
function money(input: unknown, nullable = false): number | null {
  return nullable && (input === null || input === undefined) ? null : integer(input, 0, 1000000000);
}
function date(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (
    typeof input !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
    input.startsWith("0000") ||
    !Number.isFinite(Date.parse(`${input}T00:00:00Z`)) ||
    new Date(`${input}T00:00:00Z`).toISOString().slice(0, 10) !== input
  )
    fail(400, "INVALID_BILLING_INPUT");
  return input;
}
function datePair(value: Record<string, unknown>, required: boolean) {
  const serviceStartsOn = date(value.serviceStartsOn),
    serviceEndsOn = date(value.serviceEndsOn);
  if (
    (serviceStartsOn === null) !== (serviceEndsOn === null) ||
    (required && serviceStartsOn === null) ||
    (serviceStartsOn !== null && serviceEndsOn !== null && serviceStartsOn >= serviceEndsOn)
  )
    fail(400, "INVALID_BILLING_INPUT");
  return { serviceStartsOn, serviceEndsOn };
}
export function createInput(input: unknown): BillingReceiptInput {
  const value = object(input, [
    "kind",
    "packageId",
    "period",
    "businessId",
    "source",
    "externalReference",
    "receivedAt",
    "grossMinor",
    "taxMinor",
    "feeMinor",
    "serviceStartsOn",
    "serviceEndsOn",
  ]);
  if (
    !["subscription", "photo_video"].includes(value.kind as string) ||
    !["bank", "paypal", "cash", "other"].includes(value.source as string)
  )
    fail(400, "INVALID_BILLING_INPUT");
  const subscription = value.kind === "subscription";
  if (
    subscription
      ? !["basic", "business", "premium"].includes(value.packageId as string) ||
        !["monthly", "annual"].includes(value.period as string)
      : (value.packageId !== undefined && value.packageId !== null) ||
        (value.period !== undefined && value.period !== null)
  )
    fail(400, "INVALID_BILLING_INPUT");
  const businessId =
    value.businessId === null || value.businessId === undefined ? null : uuid(value.businessId);
  if (subscription && businessId === null) fail(400, "INVALID_BILLING_INPUT");
  if (
    typeof value.receivedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.receivedAt) ||
    value.receivedAt.startsWith("0000") ||
    !Number.isFinite(Date.parse(value.receivedAt))
  )
    fail(400, "INVALID_BILLING_INPUT");
  const receivedAt = new Date(value.receivedAt).toISOString();
  if (receivedAt.replace(".000Z", "Z") !== value.receivedAt.replace(".000Z", "Z"))
    fail(400, "INVALID_BILLING_INPUT");
  return {
    kind: value.kind as BillingReceiptInput["kind"],
    packageId: subscription ? (value.packageId as BillingReceiptInput["packageId"]) : null,
    period: subscription ? (value.period as BillingReceiptInput["period"]) : null,
    businessId,
    source: value.source as BillingReceiptInput["source"],
    externalReference: text(value.externalReference, 120),
    receivedAt,
    grossMinor: integer(value.grossMinor, 1, 1000000000),
    taxMinor: money(value.taxMinor, true),
    feeMinor: money(value.feeMinor, true),
    ...datePair(value, subscription),
  };
}
export function adjustmentInput(input: unknown): BillingAdjustmentInput {
  const value = object(input, [
    "expectedVersion",
    "refundedMinor",
    "taxMinor",
    "feeMinor",
    "reason",
    "serviceStartsOn",
    "serviceEndsOn",
  ]);
  if (!Object.hasOwn(value, "taxMinor") || !Object.hasOwn(value, "feeMinor"))
    fail(400, "INVALID_BILLING_INPUT");
  if (Object.hasOwn(value, "serviceStartsOn") !== Object.hasOwn(value, "serviceEndsOn"))
    fail(400, "INVALID_BILLING_INPUT");
  const dates =
    Object.hasOwn(value, "serviceStartsOn") || Object.hasOwn(value, "serviceEndsOn")
      ? datePair(value, false)
      : {};
  return {
    expectedVersion: integer(value.expectedVersion, 1, 2147483646),
    refundedMinor: integer(value.refundedMinor, 0, 1000000000),
    taxMinor: money(value.taxMinor, true),
    feeMinor: money(value.feeMinor, true),
    reason: text(value.reason, 500, 2),
    ...dates,
  };
}
export function pageInput(input: unknown = {}) {
  const value = object(input, ["page"]);
  return integer(value.page ?? 1, 1, 999);
}
export function businessesInput(input: unknown = {}) {
  const value = object(input, ["page", "q"]);
  return {
    page: integer(value.page ?? 1, 1, 999),
    q:
      value.q === undefined || (typeof value.q === "string" && value.q.trim() === "")
        ? ""
        : text(value.q, 80),
  };
}
