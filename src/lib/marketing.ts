export type MarketingMode = "ads" | "credits" | "admin";
export const adPlacements = {
  banner: "Baner na početnoj",
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
export type MarketingOrder = {
  id: string;
  kind: Placement | ProductionService | "credits";
  status: "requested" | "quoted" | "paid" | "closed";
  quantity: number;
  amountMinor: number | null;
  creditPrice: number | null;
  instructions: string | null;
  onlinePending?: boolean;
  revokedAt?: string | null;
  productionReceiptConflict?: boolean;
  businessTitle: string | null;
  customer: string;
  startsAt: string | null;
  endsAt: string | null;
};
export type MarketingData = {
  orders: MarketingOrder[];
  more: boolean;
  balance: number;
  businesses: { id: string; title: string }[];
  productionBusinesses?: { id: string; title: string }[];
  promotions: { id: string; title: string; endsAt: string }[];
  included: { id: string; title: string; kind: "featured" | "nearby"; endsAt: string }[];
  checkoutAvailable: boolean;
};
export type MarketingCommand =
  | {
      action: "request";
      id: string;
      kind: Placement | ProductionService | "credits";
      quantity: number;
      businessId?: string;
    }
  | { action: "quote"; id: string; amountMinor: number; instructions: string; creditPrice?: number }
  | { action: "confirm"; id: string; amountMinor: number; reference: string }
  | { action: "useCredits" | "close"; id: string };
export const marketingLabels: Record<MarketingOrder["status"], string> = {
  requested: "Čeka ponudu",
  quoted: "Ponuda spremna",
  paid: "Plaćeno",
  closed: "Zatvoreno",
};
