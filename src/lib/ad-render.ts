import type { AdDevice, AdFormatId } from "./ad-catalog";

export type ServedAd = {
  campaignId: string;
  businessId: string;
  title: string;
  city: string;
  href: string;
  principalMinor?: number;
  asset?: { mimeType: string; version: number };
  images: string[];
  formatId: AdFormatId;
  position: "top" | "inline" | "side" | "bottom" | "overlay" | "icon";
  width: number;
  height: number;
  token: string;
};
export type AdCandidates = Partial<Record<AdDevice, ServedAd>>;
export type PageAds = { main: AdCandidates; icon: AdCandidates };
