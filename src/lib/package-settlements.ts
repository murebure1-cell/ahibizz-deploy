export const packageSettlementStatusLabels = {
  COMPLETED: "Potvrđena",
  REFUNDED: "Vraćena",
  REVERSED: "Stornirana",
  PARTIALLY_REFUNDED: "Djelimično vraćena",
} as const;

export type PackageSettlement = {
  id: string;
  businessTitle: string;
  paidAt: string;
  amountEurMinor: number;
  status: keyof typeof packageSettlementStatusLabels;
  needsReview: boolean;
  recorded: boolean;
};
export type PackageSettlementPage = { page: number; more: boolean; items: PackageSettlement[] };

export function readPackageSettlements(
  value: unknown,
  expectedPage: number,
): PackageSettlementPage {
  const invalid = (): never => {
    throw new Error("INVALID_PACKAGE_SETTLEMENTS");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (
    !Number.isInteger(data.page) ||
    data.page !== expectedPage ||
    expectedPage < 1 ||
    expectedPage > 9999 ||
    typeof data.more !== "boolean" ||
    !Array.isArray(data.items) ||
    data.items.length > 20
  )
    return invalid();
  const ids = new Set<string>();
  const items = data.items.map((item): PackageSettlement => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalid();
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !row.id.trim() ||
      ids.has(row.id) ||
      typeof row.businessTitle !== "string" ||
      typeof row.paidAt !== "string" ||
      !Number.isFinite(Date.parse(row.paidAt)) ||
      typeof row.amountEurMinor !== "number" ||
      !Number.isSafeInteger(row.amountEurMinor) ||
      row.amountEurMinor < 1 ||
      typeof row.status !== "string" ||
      !Object.hasOwn(packageSettlementStatusLabels, row.status) ||
      typeof row.needsReview !== "boolean" ||
      typeof row.recorded !== "boolean"
    )
      return invalid();
    ids.add(row.id);
    return {
      id: row.id,
      businessTitle: row.businessTitle,
      paidAt: row.paidAt,
      amountEurMinor: row.amountEurMinor,
      status: row.status as PackageSettlement["status"],
      needsReview: row.needsReview,
      recorded: row.recorded,
    };
  });
  return { page: expectedPage, more: data.more, items };
}
