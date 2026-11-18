import {
  createBookingSubmissions,
  receiptStatuses,
  type SubmissionStorage,
  submissionUuid,
} from "./booking-submissions";
import type { StayBooking, StayRequestInput } from "./stays";

export type StayIntent = Readonly<{
  account: string;
  businessId: string;
  unitId: string;
  kind: "customer" | "block";
  body: StayRequestInput;
}>;

export class StayRecoveryRequired extends Error {
  constructor(readonly intent: StayIntent) {
    super("stay_request_outcome_unknown");
  }
}
export function createStaySubmissions(storage: () => SubmissionStorage | null) {
  const date = /^\d{4}-\d\d-\d\d$/;
  return createBookingSubmissions<StayIntent, StayBooking>({
    domain: "stay",
    storage,
    isValid: ({ businessId, unitId, body, kind }) =>
      submissionUuid.test(businessId) &&
      submissionUuid.test(unitId) &&
      submissionUuid.test(body.requestId) &&
      Number.isSafeInteger(body.expectedUnitVersion) &&
      body.expectedUnitVersion > 0 &&
      date.test(body.checkIn) &&
      date.test(body.checkOut) &&
      body.checkIn < body.checkOut &&
      (kind === "customer" || kind === "block"),
    resourceId: (intent) => intent.unitId,
    matches: (intent, receipt) =>
      Boolean(receipt.id) &&
      receipt.businessId === intent.businessId &&
      receipt.unitId === intent.unitId &&
      receipt.kind === intent.kind &&
      receipt.checkIn === intent.body.checkIn &&
      receipt.checkOut === intent.body.checkOut &&
      receiptStatuses.includes(receipt.status),
    uncertain: (intent) => new StayRecoveryRequired(intent),
    definitiveOnRetry: (code) => code === "STAY_OVERLAP",
  });
}
export const staySubmissions = createStaySubmissions(() => window.sessionStorage);
