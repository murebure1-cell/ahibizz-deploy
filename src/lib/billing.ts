export type BillingPackageId = "basic" | "business" | "premium";
export type BillingReceiptKind = "subscription" | "photo_video";
export type BillingPeriod = "monthly" | "annual";
export type BillingSource = "bank" | "paypal" | "cash" | "other";
export type BillingActor = { id: string; role: "owner" };
export const billingDevelopmentRateBps = 2000;
export const billingCatalogVersion = 1;
export const billingPackages = [
  { id: "basic", name: "Osnovni", monthlyMinor: 2900, annualMinor: 29000 },
  { id: "business", name: "Poslovni", monthlyMinor: 4900, annualMinor: 49000 },
  { id: "premium", name: "Premium", monthlyMinor: 8900, annualMinor: 89000 },
] as const;
export type BillingCatalog = {
  currency: "BAM";
  version: number;
  packages: (typeof billingPackages)[number][];
  monthlyCommitmentMonths: 12;
  developmentRateBps: number | null;
  developmentBasis: "gross_less_refunds_tax_fees";
  contractStatus: "draft";
  operatorStatus: "unconfirmed";
  checkoutEnabled: boolean;
  automaticCharging: boolean;
  membershipActivation: false;
};
export type BillingReceipt = {
  id: string;
  kind: BillingReceiptKind;
  packageId: BillingPackageId | null;
  period: BillingPeriod | null;
  businessId: string | null;
  businessTitle: string | null;
  catalogVersion: number | null;
  quotedPriceMinor: number | null;
  commitmentMonths: number | null;
  commitmentTotalMinor: number | null;
  serviceStartsOn: string | null;
  serviceEndsOn: string | null;
  source: BillingSource;
  externalReference: string;
  receivedAt: string;
  grossMinor: number;
  refundedMinor: number;
  taxMinor: number | null;
  feeMinor: number | null;
  netBaseMinor: number | null;
  developmentRateBps: number | null;
  developmentMinor: number | null;
  allocationStatus: "pending" | "posted" | "not_applicable";
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type BillingReceiptInput = {
  kind: BillingReceiptKind;
  packageId: BillingPackageId | null;
  period: BillingPeriod | null;
  businessId: string | null;
  serviceStartsOn: string | null;
  serviceEndsOn: string | null;
  source: BillingSource;
  externalReference: string;
  receivedAt: string;
  grossMinor: number;
  taxMinor: number | null;
  feeMinor: number | null;
};
export type BillingAdjustmentInput = {
  expectedVersion: number;
  refundedMinor: number;
  taxMinor: number | null;
  feeMinor: number | null;
  reason: string;
  serviceStartsOn?: string | null;
  serviceEndsOn?: string | null;
};
export type BillingSummary = {
  receiptCount: number;
  grossMinor: number;
  refundedMinor: number;
  developmentPostedMinor: number;
  allocationPendingCount: number;
  photoVideoGrossMinor: number;
  knownNetBaseMinor: number;
  unknownNetCount: number;
  unknownNetCashMinor: number;
};
export type BillingDevelopmentEntry = {
  id: string;
  receiptId: string;
  externalReference: string;
  receiptVersion: number;
  deltaMinor: number;
  reason: string;
  createdAt: string;
};
export type BillingReply = {
  catalog?: BillingCatalog;
  actor?: BillingActor;
  receipts?: BillingReceipt[];
  receipt?: BillingReceipt | null;
  summary?: BillingSummary;
  developmentEntries?: BillingDevelopmentEntry[];
  businesses?: { id: string; title: string }[];
  page?: number;
  hasMore?: boolean;
};
export type BillingRequest = (path: string, options?: RequestInit) => Promise<BillingReply>;
export class BillingRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super("Billing request failed.");
  }
}
export const billingRequest: BillingRequest = async (path, options = {}) => {
  if (
    !/^(?:catalog|admin(?:\/development)?(?:\?page=[1-9]\d{0,2})?|admin\/businesses(?:\?(?:page=[1-9]\d{0,2}(?:&q=[^&#]*)?|q=[^&#]*(?:&page=[1-9]\d{0,2})?))?|admin\/receipts(?:\/[a-f0-9-]{36})?|admin\/commands\/[a-f0-9-]{36})$/i.test(
      path,
    )
  )
    throw new BillingRequestError("INVALID_BILLING_INPUT", 400);
  const response = await fetch(`/api/billing/${path}`, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
  });
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw new BillingRequestError(
      typeof value?.code === "string" ? value.code : "BILLING_UNAVAILABLE",
      response.status,
    );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BillingRequestError("BILLING_UNAVAILABLE");
  return value;
};
export function billingActorRequest(
  expectedAccountId: string | undefined,
  request: BillingRequest = billingRequest,
): BillingRequest {
  return (path, options = {}) => {
    if (!expectedAccountId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      return Promise.reject(new BillingRequestError("ACCOUNT_IDENTITY_CHANGED", 401));
    const headers = new Headers(options.headers);
    headers.set("X-AhiBizz-Account-ID", expectedAccountId);
    return request(path, { ...options, headers });
  };
}
export function billingAllocation({
  kind,
  grossMinor,
  refundedMinor,
  taxMinor,
  feeMinor,
  developmentRateBps,
}: Pick<
  BillingReceipt,
  "kind" | "grossMinor" | "refundedMinor" | "taxMinor" | "feeMinor" | "developmentRateBps"
>): Pick<BillingReceipt, "netBaseMinor" | "developmentMinor" | "allocationStatus"> {
  const amount = (value: number) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
  if (
    !["subscription", "photo_video"].includes(kind) ||
    !amount(grossMinor) ||
    grossMinor === 0 ||
    !amount(refundedMinor) ||
    refundedMinor > grossMinor ||
    [taxMinor, feeMinor].some((value) => value !== null && !amount(value)) ||
    (developmentRateBps !== null &&
      (!Number.isInteger(developmentRateBps) ||
        developmentRateBps < 0 ||
        developmentRateBps > 10000))
  )
    throw new RangeError("Invalid billing calculation.");
  const netBaseMinor =
    taxMinor === null || feeMinor === null
      ? null
      : Math.max(0, grossMinor - refundedMinor - taxMinor - feeMinor);
  if (kind === "photo_video")
    return { netBaseMinor, developmentMinor: null, allocationStatus: "not_applicable" };
  if (netBaseMinor === null || developmentRateBps === null)
    return { netBaseMinor, developmentMinor: null, allocationStatus: "pending" };
  return {
    netBaseMinor,
    developmentMinor: Math.floor((netBaseMinor * developmentRateBps + 5000) / 10000),
    allocationStatus: "posted",
  };
}
export function billingMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return "—";
  return `${(minor / 100).toLocaleString("bs-BA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KM`;
}
