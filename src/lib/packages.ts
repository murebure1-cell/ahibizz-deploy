/**
 * The packages the owner set on 2026-11-25 (docs/PROIZVOD.md). A package decides how many
 * businesses an account may keep; it never grants an identity or Halal badge. The names are
 * product names and stay untranslated.
 */
import { msg } from "./i18n/translate";

export const packageIds = ["basic", "startup", "business"] as const;
export type PackageId = (typeof packageIds)[number];

const catalogue: Record<PackageId, { name: string; businessLimit: number }> = {
  basic: { name: "Basic", businessLimit: 1 },
  startup: { name: "Startup", businessLimit: 3 },
  business: { name: "Business", businessLimit: 10 },
};

export function isPackageId(value: unknown): value is PackageId {
  return typeof value === "string" && (packageIds as readonly string[]).includes(value);
}
export function packageName(id: PackageId): string {
  return catalogue[id].name;
}
export function packageBusinessLimit(id: PackageId): number {
  return catalogue[id].businessLimit;
}

/** Said wherever an account with a full package reaches for one more business. */
export const packageFullText = msg(
  "Tvoj paket ne dozvoljava još jednu djelatnost. Basic dozvoljava jednu, Startup do 3, a Business do 10.",
);

export type AccountPackageDecision = {
  previousPackage: PackageId;
  package: PackageId;
  reason: string;
  actorName: string | null;
  at: string;
};
/** What an administrator sees before changing an account's package. */
export type AccountPackageSnapshot = {
  id: string;
  subjectLabel: string;
  identity: string;
  package: PackageId;
  version: number;
  businesses: number;
  businessLimit: number;
  lastDecision: AccountPackageDecision | null;
};
export type AccountPackageInput = { package: PackageId; expectedVersion: number; reason: string };

function invalid(): never {
  throw new Error("invalid_account_package_response");
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function label(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

/** Accept only the documented fields for the account that was asked about. */
export function readAccountPackage(value: unknown, expectedId: string): AccountPackageSnapshot {
  const row = exact(value, [
    "id",
    "subjectLabel",
    "identity",
    "package",
    "version",
    "businesses",
    "businessLimit",
    "lastDecision",
  ]);
  if (
    row.id !== expectedId ||
    !label(row.subjectLabel, 1000) ||
    !label(row.identity, 254) ||
    !isPackageId(row.package) ||
    !count(row.version, 2147483646) ||
    !count(row.businesses, 1000000) ||
    row.businessLimit !== packageBusinessLimit(row.package)
  )
    invalid();
  let lastDecision: AccountPackageDecision | null = null;
  if (row.lastDecision !== null) {
    const decision = exact(row.lastDecision, [
      "previousPackage",
      "package",
      "reason",
      "actorName",
      "at",
    ]);
    if (
      row.version === 0 ||
      !isPackageId(decision.previousPackage) ||
      decision.package !== row.package ||
      decision.previousPackage === decision.package ||
      !label(decision.reason, 500) ||
      (decision.actorName !== null && !label(decision.actorName, 1000)) ||
      typeof decision.at !== "string" ||
      !Number.isFinite(Date.parse(decision.at))
    )
      invalid();
    lastDecision = {
      previousPackage: decision.previousPackage,
      package: row.package,
      reason: decision.reason,
      actorName: decision.actorName,
      at: decision.at,
    };
  } else if (row.version !== 0 || row.package !== "basic") invalid();
  return {
    id: expectedId,
    subjectLabel: row.subjectLabel,
    identity: row.identity,
    package: row.package,
    version: row.version,
    businesses: row.businesses,
    businessLimit: packageBusinessLimit(row.package),
    lastDecision,
  };
}
