export type MarketingMode = "ads" | "credits" | "admin";
export const adPlacements = {
  banner: "Baner na početnoj",
  featured: "Istaknute djelatnosti na početnoj",
  nearby: "Isticanje u blizini",
} as const;
export type Placement = keyof typeof adPlacements;
export function isPlacement(value: unknown): value is Placement {
  return typeof value === "string" && Object.hasOwn(adPlacements, value);
}
export type MarketingOrder = {
  id: string;
  kind: Placement | "credits";
  status: "requested" | "quoted" | "paid" | "closed";
  quantity: number;
  amountMinor: number | null;
  creditPrice: number | null;
  instructions: string | null;
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
  promotions: { id: string; title: string; endsAt: string }[];
  included: { id: string; title: string; kind: "featured" | "nearby"; endsAt: string }[];
  checkoutAvailable: boolean;
};
export type MarketingCommand =
  | {
      action: "request";
      id: string;
      kind: Placement | "credits";
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
