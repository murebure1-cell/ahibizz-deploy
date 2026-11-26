import type { PackageId } from "./packages";

/** How many reels each package may publish (owner's decision of 2026-11-25), per account. */
export const packageReels: Record<PackageId, { period: "week" | "day"; limit: number }> = {
  basic: { period: "week", limit: 1 },
  startup: { period: "week", limit: 3 },
  business: { period: "day", limit: 1 },
};

export type ReelDay = "done" | "today" | "next" | "past";

/**
 * Where an account stands with its reels this week (Monday to Sunday in Sarajevo, as drawn).
 * `limit` null means no limit: the founder and the administration.
 */
export type ReelAllowance = {
  package: PackageId;
  period: "week" | "day";
  limit: number | null;
  used: number;
  week: ReelDay[];
};

const days: ReelDay[] = ["done", "today", "next", "past"];

export function readReelAllowance(value: unknown): ReelAllowance | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    (row.package !== "basic" && row.package !== "startup" && row.package !== "business") ||
    (row.period !== "week" && row.period !== "day") ||
    !(row.limit === null || (Number.isSafeInteger(row.limit) && (row.limit as number) > 0)) ||
    !Number.isSafeInteger(row.used) ||
    (row.used as number) < 0 ||
    !Array.isArray(row.week) ||
    row.week.length !== 7 ||
    !row.week.every((day) => days.includes(day))
  )
    return null;
  return row as ReelAllowance;
}

/** What is left in the current period; null when there is no limit. */
export function reelsLeft(allowance: ReelAllowance): number | null {
  return allowance.limit === null ? null : Math.max(0, allowance.limit - allowance.used);
}
