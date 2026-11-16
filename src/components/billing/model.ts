import {
  type BillingActor,
  type BillingDevelopmentEntry,
  type BillingReceipt,
  type BillingReply,
  BillingRequestError,
  type BillingSummary,
  billingAllocation,
} from "../../lib/billing";

export const billingUuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function invalid(): never {
  throw new BillingRequestError("BILLING_UNAVAILABLE", 502);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function nullableMoney(value: unknown) {
  return value === null || integer(value);
}
function date(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
// An untrusted successful reply cannot prove a dispatched financial write was rejected.
class BillingActorReplyError extends BillingRequestError {}

export function assertBillingOwner(
  reply: BillingReply,
  expectedAccountId: string | undefined,
): asserts reply is BillingReply & { actor: BillingActor } {
  if (!expectedAccountId || reply.actor?.id !== expectedAccountId)
    throw new BillingActorReplyError("ACCOUNT_IDENTITY_CHANGED", 401);
  if (reply.actor.role !== "owner") throw new BillingActorReplyError("OWNER_REQUIRED", 403);
}
export function billingDenied(failure: unknown): boolean {
  return failure instanceof BillingRequestError && [401, 403].includes(failure.status);
}
export function billingUncertain(failure: unknown): boolean {
  if (failure instanceof BillingActorReplyError) return true;
  return !(
    failure instanceof BillingRequestError &&
    failure.status >= 400 &&
    failure.status < 500 &&
    failure.status !== 408
  );
}
export function billingUiError(failure: unknown): string {
  if (billingDenied(failure)) return "Prijava ili administratorski pristup više nije dostupan.";
  if (failure instanceof BillingRequestError && failure.status === 409)
    return "Evidencija je izmijenjena. Provjeri trenutno stanje.";
  if (failure instanceof BillingRequestError && failure.status === 400)
    return "Provjeri unesene podatke.";
  return "Evidencija trenutno nije dostupna. Pokušaj ponovo.";
}
export function readBillingReceipt(value: unknown): BillingReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as BillingReceipt;
  if (
    !billingUuid.test(row.id) ||
    !["subscription", "photo_video"].includes(row.kind) ||
    !["bank", "paypal", "cash", "other"].includes(row.source) ||
    typeof row.externalReference !== "string" ||
    !row.externalReference.trim() ||
    !date(row.receivedAt) ||
    !date(row.createdAt) ||
    !date(row.updatedAt) ||
    !integer(row.version, 1) ||
    !integer(row.grossMinor, 1) ||
    !integer(row.refundedMinor) ||
    row.refundedMinor > row.grossMinor ||
    !nullableMoney(row.taxMinor) ||
    !nullableMoney(row.feeMinor) ||
    !nullableMoney(row.netBaseMinor) ||
    !nullableMoney(row.developmentMinor) ||
    !(
      row.developmentRateBps === null ||
      (integer(row.developmentRateBps) && row.developmentRateBps <= 10000)
    ) ||
    !(row.businessTitle === null || typeof row.businessTitle === "string") ||
    (row.kind === "subscription"
      ? !["basic", "business", "premium"].includes(row.packageId ?? "") ||
        !["monthly", "annual"].includes(row.period ?? "") ||
        !billingUuid.test(row.businessId ?? "") ||
        !integer(row.catalogVersion, 1) ||
        !integer(row.quotedPriceMinor, 1) ||
        row.commitmentMonths !== 12 ||
        !integer(row.commitmentTotalMinor, 1) ||
        !date(row.serviceStartsOn) ||
        !date(row.serviceEndsOn) ||
        (row.serviceEndsOn as string) <= (row.serviceStartsOn as string)
      : row.packageId !== null ||
        row.period !== null ||
        row.catalogVersion !== null ||
        row.quotedPriceMinor !== null ||
        row.commitmentMonths !== null ||
        row.commitmentTotalMinor !== null ||
        !(row.businessId === null || billingUuid.test(row.businessId)) ||
        (row.serviceStartsOn === null || row.serviceEndsOn === null
          ? row.serviceStartsOn !== null || row.serviceEndsOn !== null
          : !date(row.serviceStartsOn) ||
            !date(row.serviceEndsOn) ||
            row.serviceEndsOn <= row.serviceStartsOn))
  )
    invalid();
  const allocation = billingAllocation(row);
  if (
    allocation.netBaseMinor !== row.netBaseMinor ||
    allocation.developmentMinor !== row.developmentMinor ||
    allocation.allocationStatus !== row.allocationStatus
  )
    invalid();
  return row;
}
export function readBillingSummary(value: unknown): BillingSummary {
  if (!value || typeof value !== "object") invalid();
  const row = value as BillingSummary;
  for (const key of [
    "receiptCount",
    "grossMinor",
    "refundedMinor",
    "developmentPostedMinor",
    "allocationPendingCount",
    "photoVideoGrossMinor",
    "knownNetBaseMinor",
    "unknownNetCount",
    "unknownNetCashMinor",
  ] as const)
    if (!integer(row[key])) invalid();
  return row;
}
export function readBillingEntries(value: unknown): BillingDevelopmentEntry[] {
  if (!Array.isArray(value) || value.length > 30) invalid();
  const entries = value as BillingDevelopmentEntry[];
  if (
    entries.some(
      (row) =>
        !row ||
        !billingUuid.test(row.id) ||
        !billingUuid.test(row.receiptId) ||
        !integer(row.receiptVersion, 1) ||
        typeof row.externalReference !== "string" ||
        !row.externalReference.trim() ||
        row.externalReference.length > 120 ||
        !Number.isSafeInteger(row.deltaMinor) ||
        !date(row.createdAt) ||
        typeof row.reason !== "string",
    ) ||
    new Set(entries.map((row) => row.id)).size !== entries.length
  )
    invalid();
  return entries;
}
export function billingMoneyInput(value: string, optional = false): number | null {
  const text = value.trim();
  if (!text && optional) return null;
  if (!/^\d{1,9}(?:[,.]\d{1,2})?$/.test(text))
    throw new Error("Upiši iznos sa najviše dvije decimale.");
  const [whole, decimals = ""] = text.replace(",", ".").split(".");
  const minor = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Provjeri iznos.");
  return minor;
}
export function billingInputValue(value: number | null): string {
  return value === null ? "" : (value / 100).toFixed(2).replace(".", ",");
}
