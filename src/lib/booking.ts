export type BookingWindow = { weekday: number; startMinute: number; endMinute: number };
export type BookingServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number;
  active: boolean;
};
export type BookingServiceInput = Omit<BookingServiceOption, "id"> & { id?: string };
export type BookingSettings = {
  enabled: boolean;
  timezone: string;
  version: number;
  windows: BookingWindow[];
  services: BookingServiceOption[];
};
export type BookingSettingsInput = Omit<BookingSettings, "version" | "services"> & {
  expectedVersion: number;
  services: BookingServiceInput[];
};
export type PublicBookingConfiguration = {
  enabled: boolean;
  timezone: string;
  version: number;
  services: Omit<BookingServiceOption, "active">[];
};
export type BookingSlot = { startsAt: string; endsAt: string };
export type BookingStatus = "requested" | "confirmed" | "cancelled" | "completed" | "declined";
export type BookingKind = "customer" | "manual" | "block";
export type BookingAction = "approve" | "decline" | "cancel" | "complete";
export type BookingListView = "upcoming" | "history";
export type BookingEntry = BookingSlot & {
  id: string;
  businessId: string;
  businessTitle: string;
  timezone: string;
  kind: BookingKind;
  serviceId: string | null;
  serviceName: string | null;
  durationMinutes: number | null;
  priceMinor: number;
  status: BookingStatus;
  version: number;
  customerId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
};
export const bookingStatusLabels: Record<BookingStatus, string> = {
  requested: "Čeka odobrenje",
  confirmed: "Potvrđen",
  cancelled: "Otkazan",
  completed: "Održan",
  declined: "Odbijen",
};
/** Active appointments remain current until their exact end, including an appointment in progress. */
export function bookingIsUpcoming(
  entry: Pick<BookingEntry, "status" | "endsAt">,
  asOf: number,
): boolean {
  return (
    (entry.status === "requested" || entry.status === "confirmed") &&
    Date.parse(entry.endsAt) > asOf
  );
}
const bookingMonths = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "August",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

export function bookingMoney(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return "—";
  const whole = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${String(minor % 100).padStart(2, "0")} KM`;
}

export function bookingMonth(value: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) || value.startsWith("0000")) return "—";
  return `${bookingMonths[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}`;
}

export function bookingDate(
  iso: string,
  timezone: string,
  { time = false }: { time?: boolean } = {},
): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(time
          ? { hour: "2-digit" as const, minute: "2-digit" as const, hourCycle: "h23" as const }
          : {}),
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    const label = `${Number(values.day)}. ${Number(values.month)}. ${values.year}.`;
    return time ? `${label} u ${values.hour}:${values.minute}` : label;
  } catch {
    return "—";
  }
}
