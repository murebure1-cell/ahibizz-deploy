export type StayUnit = {
  id: string;
  businessId: string;
  name: string;
  type: "room" | "apartment";
  beds: number;
  description: string | null;
  photoSlots: number[];
  priceMinor: number;
  enabled: boolean;
  version: number;
};
export type StayUnitInput = Omit<StayUnit, "id" | "businessId" | "version" | "photoSlots"> & {
  id?: string;
  expectedVersion: number;
  photoSlots?: number[];
};
export type StayInterval = { checkIn: string; checkOut: string };
export type StayBooking = StayInterval & {
  id: string;
  businessId: string;
  businessTitle: string;
  unitId: string;
  unitName: string;
  timezone: string;
  kind: "customer" | "block";
  status: "requested" | "confirmed" | "declined" | "cancelled";
  version: number;
  customerName: string | null;
  totalMinor: number;
};
export type StayCatalog = {
  eligible: boolean;
  timezone: string;
  units: StayUnit[];
  upcoming?: StayBooking[];
};
export type StayRequestInput = StayInterval & {
  requestId: string;
  expectedUnitVersion: number;
};
export type StayDecisionInput = {
  action: "approve" | "decline" | "cancel";
  expectedVersion: number;
};
/** Inputs are local calendar dates. UTC midnight is only used for date arithmetic. */
export function stayNights(checkIn: string, checkOut: string) {
  return (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
}
export function stayQuote(priceMinor: number, checkIn: string, checkOut: string) {
  return priceMinor * stayNights(checkIn, checkOut);
}
