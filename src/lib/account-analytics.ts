import type { PackageId } from "./packages";

/** The periods "Analitika" offers, in days. */
export const analyticsPeriods = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof analyticsPeriods)[number];
export type AnalyticsSource = "search" | "category" | "map" | "other";
export type AnalyticsTouch = "call" | "message" | "map";

/**
 * What the owner sees on "Analitika". What a package does not include is null and is never sent:
 * Basic gets the two totals, Startup adds days, taps and sources, Business adds the comparison
 * with the previous period, the busiest hour and the export.
 */
export type AccountAnalytics = {
  /** Null for the administrator account, which sees everything. */
  package: PackageId | null;
  businesses: { id: string; title: string }[];
  business: string | null;
  days: AnalyticsPeriod;
  profileViews: number;
  businessViews: number;
  previous: { profileViews: number; businessViews: number; touches: number } | null;
  daily: { day: string; views: number }[] | null;
  touches: Record<AnalyticsTouch, number> | null;
  sources: Record<AnalyticsSource, number> | null;
  peak: { weekday: number; hour: number } | null;
};

export function analyticsPath(business: string | null, days: AnalyticsPeriod) {
  const params = new URLSearchParams();
  if (business) params.set("djelatnost", business);
  if (days !== 30) params.set("dana", String(days));
  const query = params.toString();
  return `/nalog/analitika${query ? `?${query}` : ""}`;
}
