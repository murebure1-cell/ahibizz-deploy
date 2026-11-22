import type { BookingEntry } from "./booking";
import { BookingRequestError } from "./booking-client";

export type CustomerAppointmentPage = {
  key: string;
  entries: BookingEntry[];
  more: boolean;
};

export type CustomerAppointmentsState = {
  result: CustomerAppointmentPage | null;
  requiresLogin: boolean;
};

const immutableEntryFields = [
  "id",
  "businessId",
  "businessTitle",
  "timezone",
  "kind",
  "serviceId",
  "serviceName",
  "durationMinutes",
  "priceMinor",
  "startsAt",
  "endsAt",
  "customerId",
  "clientName",
  "clientEmail",
  "clientPhone",
] as const satisfies readonly (keyof BookingEntry)[];

/** Cancellation changes only status/version of the original customer's appointment. */
export function readCustomerCancellation(
  value: unknown,
  original: BookingEntry,
  expectedAccountId: string | undefined,
): BookingEntry {
  if (
    !expectedAccountId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId) ||
    original.customerId !== expectedAccountId ||
    original.kind !== "customer" ||
    !["requested", "confirmed"].includes(original.status) ||
    !Number.isSafeInteger(original.version) ||
    original.version < 1 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new Error("unconfirmed_customer_cancellation");
  const entry = value as BookingEntry;
  if (
    entry.status !== "cancelled" ||
    !Number.isSafeInteger(entry.version) ||
    entry.version <= original.version ||
    entry.version > 2147483647 ||
    immutableEntryFields.some((field) => entry[field] !== original[field])
  )
    throw new Error("unconfirmed_customer_cancellation");
  return { ...original, status: "cancelled", version: entry.version };
}

/** Patch the accepted page immediately; a failed refresh must not restore its old action. */
export function customerAppointmentCancelled(
  previous: CustomerAppointmentsState,
  cancellation: BookingEntry,
): CustomerAppointmentsState {
  if (previous.requiresLogin || !previous.result) return previous;
  const page = previous.result,
    original = page.entries.find((entry) => entry.id === cancellation.id);
  if (
    !original ||
    original.businessId !== cancellation.businessId ||
    original.customerId !== cancellation.customerId ||
    original.version > cancellation.version
  )
    return previous;
  const view = page.key.split(":")[0];
  if (view !== "upcoming" && view !== "history") return previous;
  return {
    ...previous,
    result: {
      ...page,
      entries:
        view === "upcoming"
          ? page.entries.filter((entry) => entry.id !== cancellation.id)
          : page.entries.map((entry) =>
              entry.id === cancellation.id ? { ...cancellation } : entry,
            ),
    },
  };
}

/** Confirmed cancellations are terminal for this actor's mounted workspace. */
export function reconcileCustomerCancellations(
  page: CustomerAppointmentPage,
  cancellations: Iterable<BookingEntry>,
): CustomerAppointmentPage {
  let state: CustomerAppointmentsState = { result: page, requiresLogin: false };
  for (const cancellation of cancellations) {
    const entry = page.entries.find((item) => item.id === cancellation.id);
    if (
      entry &&
      (entry.customerId !== cancellation.customerId ||
        entry.businessId !== cancellation.businessId ||
        (entry.version > cancellation.version && entry.status !== "cancelled"))
    )
      throw new Error("invalid_customer_cancellation_regression");
    state = customerAppointmentCancelled(state, cancellation);
  }
  return state.result ?? page;
}

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
