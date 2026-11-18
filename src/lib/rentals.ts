export const RENTAL_BRANDS = [
  "Audi",
  "BMW",
  "Citroën",
  "Cupra",
  "Dacia",
  "Fiat",
  "Ford",
  "Honda",
  "Hyundai",
  "Jeep",
  "Kia",
  "Land Rover",
  "Lexus",
  "Mazda",
  "Mercedes-Benz",
  "MINI",
  "Mitsubishi",
  "Nissan",
  "Opel",
  "Peugeot",
  "Renault",
  "SEAT",
  "Škoda",
  "Suzuki",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
  "Ostalo",
] as const;

export type RentalVehicle = {
  id: string;
  businessId: string;
  name: string;
  brand: string;
  model: string;
  year: number | null;
  seats: number;
  fuel: "petrol" | "diesel" | "hybrid" | "electric";
  transmission: "manual" | "automatic";
  description: string | null;
  photoSlot: number | null;
  priceMinor: number;
  priceUnit: "hour" | "day";
  enabled: boolean;
  version: number;
};
export type RentalVehicleInput = Omit<
  RentalVehicle,
  "id" | "businessId" | "version" | "photoSlot"
> & {
  id?: string;
  expectedVersion: number;
  photoSlot?: number | null;
};
export type RentalCatalog = {
  eligible: boolean;
  timezone: string;
  vehicles: RentalVehicle[];
  upcoming?: RentalBooking[];
};
export type RentalInterval = { startsAt: string; endsAt: string };
export type RentalBooking = RentalInterval & {
  id: string;
  businessId: string;
  businessTitle: string;
  vehicleId: string;
  vehicleName: string;
  timezone: string;
  kind: "customer" | "block";
  status: "requested" | "confirmed" | "declined" | "cancelled";
  version: number;
  customerName: string | null;
  totalMinor: number;
};
export type RentalRequestInput = RentalInterval & {
  requestId: string;
  expectedVehicleVersion: number;
};
export type RentalDecisionInput = {
  action: "approve" | "decline" | "cancel";
  expectedVersion: number;
};

/** Price per started elapsed hour or started 24-hour period, including across DST. */
export function rentalQuote(
  priceMinor: number,
  priceUnit: RentalVehicle["priceUnit"],
  startsAt: string,
  endsAt: string,
): number {
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  return Math.ceil(duration / (priceUnit === "hour" ? 3_600_000 : 86_400_000)) * priceMinor;
}
