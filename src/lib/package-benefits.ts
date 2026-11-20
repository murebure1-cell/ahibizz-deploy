import { type BillingPackageId, billingPackages } from "./billing";
export type TierBenefits = { enabled: boolean; nearbyDays: number; featuredDays: number };
export type PackageBenefits = Record<BillingPackageId, TierBenefits>;
export type PackageBenefitsCatalog = { version: number; benefits: PackageBenefits };
export const initialPackageBenefits: PackageBenefits = {
  basic: { enabled: true, nearbyDays: 0, featuredDays: 0 },
  business: { enabled: true, nearbyDays: 7, featuredDays: 0 },
  premium: { enabled: true, nearbyDays: 15, featuredDays: 7 },
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function validBenefits(v: unknown): v is PackageBenefits {
  if (!record(v) || Object.keys(v).length !== 3) return false;
  const days = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 31;
  return billingPackages.every(({ id }) => {
    const plan = v[id];
    return (
      record(plan) &&
      Object.keys(plan).length === 3 &&
      typeof plan.enabled === "boolean" &&
      days(plan.nearbyDays) &&
      days(plan.featuredDays)
    );
  });
}

export function readPackageBenefits(value: unknown): PackageBenefitsCatalog | null {
  return record(value) &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    value.version > 0 &&
    validBenefits(value.benefits)
    ? { version: value.version, benefits: value.benefits }
    : null;
}
