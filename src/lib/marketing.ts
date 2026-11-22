import type { CampaignBrief, CampaignSummary } from "./ad-brief";
import type { AdPricing } from "./ad-pricing";
import type { BusinessMediaAsset } from "./business-media";
import { businessUuid } from "./business-today";

export type MarketingMode = "ads" | "credits" | "admin";
export const categoryPromotionPriceBamMinor = 1000;
export type PromotionView = "aktivne" | "zakazane";
export function readPromotionView(value: unknown): PromotionView | undefined {
  return value === "aktivne" || value === "zakazane" ? value : undefined;
}
export const adPlacements = {
  banner: "Reklamna kampanja",
  featured: "Istaknute djelatnosti na početnoj",
  nearby: "Isticanje u blizini",
} as const;
export type Placement = keyof typeof adPlacements;
export const productionServices = {
  photo: "Fotografisanje",
  video: "Video snimanje",
  photo_video: "Foto i video",
} as const;
export type ProductionService = keyof typeof productionServices;
export function isProductionService(value: unknown): value is ProductionService {
  return typeof value === "string" && Object.hasOwn(productionServices, value);
}
export function isPlacement(value: unknown): value is Placement {
  return typeof value === "string" && Object.hasOwn(adPlacements, value);
}
export type PlacementTarget = { businessId: string; placement: Placement };

export function placementOfferPath({ businessId, placement }: PlacementTarget) {
  return `/nalog?odjeljak=oglasi&mjesto=${placement}&djelatnost=${encodeURIComponent(businessId)}`;
}

export function readPlacementTarget(params: URLSearchParams): PlacementTarget | undefined {
  if (params.size !== 3 || params.get("odjeljak") !== "oglasi") return;
  const businessId = params.get("djelatnost"),
    placement = params.get("mjesto");
  if (businessUuid(businessId) && isPlacement(placement)) return { businessId, placement };
}

export type MarketingOrder = {
  id: string;
  kind: Placement | ProductionService | "credits";
  status: "requested" | "quoted" | "paid" | "closed";
  quantity: number;
  amountMinor: number | null;
  creditPrice: number | null;
  instructions: string | null;
  onlinePending?: boolean;
  bankTopUp?: boolean;
  revokedAt?: string | null;
  productionReceiptConflict?: boolean;
  campaign?: CampaignSummary | null;
  businessTitle: string | null;
  customer: string;
  startsAt: string | null;
  endsAt: string | null;
};
export type CreditMovement = { id: string; label: string; amount: number; createdAt: string };
export type MarketingData = {
  creditUnitBamMinor?: number | null;
  movements?: CreditMovement[];
  orders: MarketingOrder[];
  more: boolean;
  balance: number;
  businesses: { id: string; title: string; website?: boolean; assets?: BusinessMediaAsset[] }[];
  adPricing?: AdPricing;
  locations?: { cities: string[]; countries: string[] };
  categories?: { id: string; name: string }[];
  productionBusinesses?: { id: string; title: string }[];
  promotions: { id: string; title: string; endsAt: string }[];
  included: { id: string; title: string; kind: "featured" | "nearby"; endsAt: string }[];
  checkoutAvailable: boolean;
};
export type MarketingCommand =
  | { action: "topUp"; id: string; quantity: number; expectedAmountMinor: number }
  | {
      action: "setCreditRate";
      id: string;
      unitBamMinor: number;
      expectedUnitBamMinor: number | null;
    }
  | { action: "promoteCategory"; id: string; businessId: string; expectedCreditMinor: number }
  | {
      action: "request";
      id: string;
      kind: Placement | ProductionService | "credits";
      quantity: number;
      businessId?: string;
      campaign?: CampaignBrief;
    }
  | {
      action: "quote";
      id: string;
      amountMinor: number;
      instructions: string;
      creditPrice?: number;
      campaignBenefit?: "advance" | "welcome";
      offerStandardTargeting?: true;
      expectedAssetVersion?: number;
    }
  | { action: "confirm"; id: string; amountMinor: number; reference: string }
  | { action: "useCredits" | "close"; id: string };
export const marketingLabels: Record<MarketingOrder["status"], string> = {
  requested: "Čeka ponudu",
  quoted: "Ponuda spremna",
  paid: "Plaćeno",
  closed: "Zatvoreno",
};
