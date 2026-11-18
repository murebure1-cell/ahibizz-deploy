import {
  createBookingSubmissions,
  receiptStatuses,
  type SubmissionStorage,
  submissionUuid,
} from "./booking-submissions";
import { isTimeZone } from "./booking-time";
import type { RentalBooking, RentalRequestInput } from "./rentals";

export type RentalIntent = Readonly<{
  account: string;
  businessId: string;
  vehicleId: string;
  vehicleName: string;
  timezone: string;
  kind: "customer" | "block";
  body: RentalRequestInput;
}>;

export class RentalRecoveryRequired extends Error {
  constructor(readonly intent: RentalIntent) {
    super("rental_request_outcome_unknown");
  }
}

function isInstant(value: string) {
  return (
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function createRentalSubmissions(storage: () => SubmissionStorage | null) {
  return createBookingSubmissions<RentalIntent, RentalBooking>({
    domain: "rental",
    storage,
    isValid: ({ businessId, vehicleId, vehicleName, timezone, body, kind }) =>
      submissionUuid.test(businessId) &&
      submissionUuid.test(vehicleId) &&
      submissionUuid.test(body.requestId) &&
      typeof vehicleName === "string" &&
      vehicleName.length > 0 &&
      vehicleName.length <= 100 &&
      isTimeZone(timezone) &&
      Number.isSafeInteger(body.expectedVehicleVersion) &&
      body.expectedVehicleVersion > 0 &&
      isInstant(body.startsAt) &&
      isInstant(body.endsAt) &&
      body.startsAt < body.endsAt &&
      (kind === "customer" || kind === "block"),
    resourceId: (intent) => intent.vehicleId,
    matches: (intent, receipt) =>
      submissionUuid.test(receipt.id) &&
      receipt.businessId === intent.businessId &&
      receipt.vehicleId === intent.vehicleId &&
      receipt.kind === intent.kind &&
      receipt.startsAt === intent.body.startsAt &&
      receipt.endsAt === intent.body.endsAt &&
      receiptStatuses.includes(receipt.status),
    uncertain: (intent) => new RentalRecoveryRequired(intent),
    // These rejections are reached only after the actor's stored request was looked up.
    definitiveOnRetry: (code) =>
      [
        "RENTAL_OVERLAP",
        "RENTAL_NOT_AVAILABLE",
        "INVALID_RENTAL_INTERVAL",
        "RENTAL_OFFER_VERSION_CHANGED",
        "SELF_BOOKING_NOT_ALLOWED",
      ].includes(code),
  });
}
export const rentalSubmissions = createRentalSubmissions(() => window.sessionStorage);
