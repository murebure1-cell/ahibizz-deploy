import type { BookingEntry } from "./booking";
import { BookingRequestError } from "./booking-client";

export type CustomerAppointmentPage = {
  key: string;
  entries: BookingEntry[];
  more: boolean;
  credits: number | null;
};

export type CustomerAppointmentsState = {
  result: CustomerAppointmentPage | null;
  requiresLogin: boolean;
};

/** A denied private read or write invalidates every cached appointment, including hidden pages. */
export function customerAppointmentsFailed(
  previous: CustomerAppointmentsState,
  failure: unknown,
): CustomerAppointmentsState {
  if (failure instanceof BookingRequestError && (failure.status === 401 || failure.status === 403))
    return { result: null, requiresLogin: true };
  // A temporary outage may retain an accepted page, but cannot resurrect a denied one.
  return previous;
}
