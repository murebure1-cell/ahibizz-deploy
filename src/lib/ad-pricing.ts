import { getAdPlacement } from "./ad-catalog";

export type AdRateOverride = {
  formatId: string;
  page: string;
  device: string;
  available: boolean;
  cpmMinor: number | null;
};
export type AdTerms = {
  minimumMinor: number;
  volumePercent: number[];
  advancePercent: number;
  welcomePercent: number;
};
export type AdPricing = {
  version: number;
  terms: AdTerms;
  overrides: AdRateOverride[];
  contactPhone?: string | null;
};
export type AdPricingChange = (
  | ({ action: "rate" } & AdRateOverride)
  | ({ action: "terms" } & AdTerms)
  | { action: "contact"; contactPhone: string | null }
) & { version: number };
export const volumeThresholds = [100000, 300000, 400000, 500000, 1000001] as const;
export const volumeLabels = [
  "100.000 – 299.999",
  "300.000 – 399.999",
  "400.000 – 499.999",
  "500.000 – 1.000.000",
  "Preko 1.000.000",
] as const;
const int = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export function parseAdPricingChange(input: unknown): AdPricingChange | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (!int(row.version, 1, 2147483646)) return null;
  const exact = (keys: string[]) =>
    Object.keys(row).length === keys.length && keys.every((k) => Object.hasOwn(row, k));
  if (
    row.action === "contact" &&
    exact(["version", "action", "contactPhone"]) &&
    (row.contactPhone === null ||
      (typeof row.contactPhone === "string" && /^\+[1-9]\d{6,14}$/.test(row.contactPhone)))
  )
    return { action: "contact", version: row.version, contactPhone: row.contactPhone };
  if (
    row.action === "rate" &&
    exact(["action", "version", "formatId", "page", "device", "available", "cpmMinor"]) &&
    typeof row.formatId === "string" &&
    typeof row.page === "string" &&
    typeof row.device === "string" &&
    getAdPlacement(row.formatId, row.page, row.device) &&
    typeof row.available === "boolean" &&
    (row.cpmMinor === null || int(row.cpmMinor, 1, 1000000))
  )
    return {
      action: "rate",
      version: row.version,
      formatId: row.formatId,
      page: row.page,
      device: row.device,
      available: row.available,
      cpmMinor: row.cpmMinor,
    };
  if (
    row.action === "terms" &&
    exact([
      "action",
      "version",
      "minimumMinor",
      "advancePercent",
      "welcomePercent",
      "volumePercent",
    ]) &&
    int(row.minimumMinor, 0, 100000000) &&
    int(row.advancePercent, 0, 99) &&
    int(row.welcomePercent, 0, 99) &&
    Array.isArray(row.volumePercent) &&
    row.volumePercent.length === 5 &&
    row.volumePercent.every((v, i, a) => int(v, 0, 99) && (!i || v >= a[i - 1]))
  )
    return {
      action: "terms",
      version: row.version,
      minimumMinor: row.minimumMinor,
      advancePercent: row.advancePercent,
      welcomePercent: row.welcomePercent,
      volumePercent: [...row.volumePercent],
    };
  return null;
}
export function getAdRate(
  pricing: AdPricing,
  formatId: string,
  page: string,
  device: string,
): { available: boolean; cpmMinor: number | null } {
  const placement = getAdPlacement(formatId, page, device);
  if (!placement) return { available: false, cpmMinor: null };
  const found = pricing.overrides.find(
    (r) => r.formatId === formatId && r.page === page && r.device === device,
  );
  return found
    ? { available: found.available, cpmMinor: found.cpmMinor }
    : { available: true, cpmMinor: placement.defaultCpmMinor };
}
export function estimateAdCampaign(
  pricing: AdPricing,
  formatId: string,
  page: string,
  device: string,
  impressions: number,
  benefit: "none" | "advance" | "welcome" = "none",
) {
  const rate = getAdRate(pricing, formatId, page, device);
  if (!rate.available || rate.cpmMinor === null || !int(impressions, 1, 100000000)) return null;
  const tier = volumeThresholds.findLastIndex((minimum) => impressions >= minimum);
  const discountPercent = Math.max(
    tier < 0 ? 0 : (pricing.terms.volumePercent[tier] ?? 0),
    benefit === "advance"
      ? pricing.terms.advancePercent
      : benefit === "welcome"
        ? pricing.terms.welcomePercent
        : 0,
  );
  const grossMinor = Math.ceil((impressions * rate.cpmMinor) / 1000);
  const netMinor = Math.round((grossMinor * (100 - discountPercent)) / 100);
  return {
    grossMinor,
    netMinor,
    discountPercent,
    minimumMinor: pricing.terms.minimumMinor,
    belowMinimum: netMinor < pricing.terms.minimumMinor,
  };
}
