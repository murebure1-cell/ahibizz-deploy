import { type AdDevice, type AdFormatId, type AdPage, getAdPlacement } from "./ad-catalog";

import type { DailyAdWindow } from "./ad-geo-schedule";
export type CampaignSelection = {
  device: AdDevice;
  page: AdPage;
  format: AdFormatId;
  impressionGoal?: number;
};
export type CampaignBrief = CampaignSelection & {
  impressionGoal: number;
  budgetMinor: number | null;
  startsOn: string | null;
  city: string | null;
  countryCode: string | null;
  targetCities: string[];
  dailyWindow: DailyAdWindow | null;
  categoryId: string | null;
  keyword: string | null;
  creative: { kind: "logo" | "cover" | "gallery"; slot: number; version: number } | null;
  destinationWebsite: boolean;
  targetingNote: string | null;
  targetGender: "women" | "men" | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
};
export type CampaignSummary = CampaignBrief & {
  assetVersion: number;
  replacedTargetingNote: string | null;
  categoryName: string | null;
  destinationUrl: string | null;
  impressions: number;
  clicks: number;
  estimateMinor: number | null;
  minimumMinor: number;
  advanceMinor: number | null;
  welcomeMinor: number | null;
  benefit: "advance" | "welcome" | null;
};
export function campaignPath(s: CampaignSelection) {
  const p = new URLSearchParams({
    odjeljak: "oglasi",
    format: s.format,
    stranica: s.page,
    uredjaj: s.device,
  });
  if (s.impressionGoal !== undefined) p.set("prikazi", String(s.impressionGoal));
  return `/nalog?${p}`;
}
export function readCampaignSelection(params: URLSearchParams): CampaignSelection | undefined {
  if (params.get("odjeljak") !== "oglasi" || params.size !== (params.has("prikazi") ? 5 : 4))
    return;
  const format = params.get("format"),
    page = params.get("stranica"),
    device = params.get("uredjaj");
  if (!format || !page || !device || !getAdPlacement(format, page, device)) return;
  const goal = params.get("prikazi");
  if (goal !== null && (!/^[1-9]\d{3,7}$/.test(goal) || Number(goal) > 10000000)) return;
  return {
    format: format as AdFormatId,
    page: page as AdPage,
    device: device as AdDevice,
    ...(goal ? { impressionGoal: Number(goal) } : {}),
  };
}
