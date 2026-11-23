import { bosnianMoney } from "./number-format";

export const promotionKinds = ["home", "nearby", "category", "banner"] as const;
export const promotionDurations = [7, 14, 30] as const;
export type PromotionKind = (typeof promotionKinds)[number];
export type PromotionDuration = (typeof promotionDurations)[number];
export const promotionLabels: Record<PromotionKind, string> = {
  home: "Istaknuto na početnoj",
  nearby: "Istaknuto u blizini",
  category: "Istaknuto u kategoriji",
  banner: "Baner na početnoj",
};
export const promotionCapacity: Record<PromotionKind, number> = {
  home: 6,
  nearby: 3,
  category: 3,
  banner: 1,
};
export type PromotionPrice = {
  kind: PromotionKind;
  durationDays: PromotionDuration;
  amountBamMinor: number;
};
export const promotionPrices: PromotionPrice[] = promotionKinds.flatMap((kind) => {
  const prices = {
    home: [2500, 4500, 8000],
    nearby: [1500, 2500, 4500],
    category: [1000, 1800, 3000],
    banner: [4000, 7000, 12000],
  }[kind];
  return promotionDurations.map((durationDays, index) => ({
    kind,
    durationDays,
    amountBamMinor: prices[index] as number,
  }));
});
export type PromotionBank = {
  recipient: string;
  name: string;
  currency: "BAM" | "EUR";
  iban: string | null;
  accountNumber: string | null;
  bic: string | null;
  address: string | null;
  note: string | null;
};
export type PromotionOrder = {
  id: string;
  businessId: string;
  businessTitle: string;
  ownerId: string;
  kind: PromotionKind;
  durationDays: PromotionDuration;
  startsAt: string;
  endsAt: string;
  amountBamMinor: number;
  amountEurMinor: number;
  paymentReference: string;
  status: "pending" | "active" | "completed" | "cancelled";
  confirmedBy: string | null;
  confirmedAt: string | null;
  statementReference: string | null;
  manual: boolean;
  note: string | null;
  hasImage: boolean;
  bank: PromotionBank | null;
};
export function bamToEuroMinor(bamMinor: number) {
  return Math.round((bamMinor * 100000) / 195583);
}
export function promotionMoney(amountMinor: number, currency: "BAM" | "EUR" = "BAM") {
  return `${bosnianMoney(amountMinor)} ${currency === "BAM" ? "KM" : "EUR"}`;
}
export function isPromotionKind(value: unknown): value is PromotionKind {
  return promotionKinds.includes(value as PromotionKind);
}
export function isPromotionDuration(value: unknown): value is PromotionDuration {
  return promotionDurations.includes(value as PromotionDuration);
}
export function isPromotionReference(value: unknown): value is string {
  return typeof value === "string" && /^AHI-[a-f0-9]{32}$/.test(value);
}
export function promotionStatusLabel(
  order: Pick<PromotionOrder, "status" | "startsAt" | "endsAt">,
  now = Date.now(),
) {
  if (order.status === "cancelled") return "Otkazano";
  if (order.status === "pending") return "Na čekanju";
  if (order.status === "completed" || Date.parse(order.endsAt) <= now) return "Završeno";
  return Date.parse(order.startsAt) > now ? "Zakazano" : "Aktivno";
}
export type PromotionReservation = { startsAt: string; endsAt: string };
/** Half-open periods allow a new promotion at the exact previous end. */
export function firstAvailablePromotionStart(
  reservations: PromotionReservation[],
  startsAt: string,
  durationDays: PromotionDuration,
  capacity: number,
) {
  const initial = Date.parse(startsAt),
    duration = durationDays * 86400000;
  if (
    !Number.isFinite(initial) ||
    !isPromotionDuration(durationDays) ||
    !Number.isInteger(capacity) ||
    capacity < 1
  )
    throw new Error("Neispravan period isticanja.");
  const periods = reservations
    .map((r) => [Date.parse(r.startsAt), Date.parse(r.endsAt)] as const)
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start < end);
  const available = (candidate: number) => {
    const points = [
      candidate,
      ...periods
        .map(([start]) => start)
        .filter((start) => start > candidate && start < candidate + duration),
    ];
    return points.every(
      (point) => periods.filter(([start, end]) => start <= point && end > point).length < capacity,
    );
  };
  const candidates = [
    initial,
    ...periods.map(([, end]) => end).filter((end) => end > initial),
  ].sort((a, b) => a - b);
  const first = candidates.find(available) as number;
  return {
    available: first === initial,
    firstAvailableAt: new Date(first).toISOString(),
    capacity,
  };
}
