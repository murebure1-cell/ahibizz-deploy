import type { BookingEntry } from "./booking";
import { BookingRequestError, type bookingRequest, bookingWrite } from "./booking-client";

export type BookingQuote = Readonly<{
  serviceId: string;
  startsAt: string;
  configurationVersion: number;
}>;

type Intent = {
  quote: BookingQuote;
  body: string;
  key: string;
  uncertain: boolean;
};

export class BookingSubmissionPendingError extends Error {
  constructor() {
    super("The previous booking request must be verified first.");
  }
}

export class BookingSubmissionBusyError extends Error {
  constructor() {
    super("A booking request is already in progress.");
  }
}

/** One mounted booking form's intent. Reloading or leaving the form does not persist it. */
export function createBookingSubmission(businessId: string) {
  let intent: Intent | null = null;
  let running = false;

  async function run(value: Intent, request: typeof bookingRequest): Promise<BookingEntry> {
    if (running) throw new BookingSubmissionBusyError();
    running = true;
    const wasUncertain = value.uncertain;
    try {
      const data = await request(`businesses/${businessId}/requests`, {
        ...bookingWrite("POST", value.quote, value.key),
        body: value.body,
      });
      const entry = data.entry;
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id ||
        entry.businessId !== businessId ||
        entry.kind !== "customer" ||
        entry.serviceId !== value.quote.serviceId ||
        entry.startsAt !== value.quote.startsAt ||
        !Number.isInteger(entry.version) ||
        entry.version < 1 ||
        !["requested", "confirmed", "cancelled", "completed", "declined"].includes(entry.status)
      )
        throw new Error("unconfirmed_booking_request");
      intent = null;
      return entry as BookingEntry;
    } catch (failure) {
      const rejected =
        failure instanceof BookingRequestError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408;
      // A later authorization or conflict error cannot disprove an earlier committed request.
      if (rejected && !wasUncertain) intent = null;
      else value.uncertain = true;
      throw failure;
    } finally {
      running = false;
    }
  }

  return {
    get uncertain() {
      return intent?.uncertain ?? false;
    },
    async submit(quote: BookingQuote, request: typeof bookingRequest) {
      if (running) throw new BookingSubmissionBusyError();
      if (intent?.uncertain) throw new BookingSubmissionPendingError();
      const snapshot = Object.freeze({
        serviceId: quote.serviceId,
        startsAt: quote.startsAt,
        configurationVersion: quote.configurationVersion,
      });
      intent = {
        quote: snapshot,
        body: JSON.stringify(snapshot),
        key: crypto.randomUUID(),
        uncertain: false,
      };
      return run(intent, request);
    },
    async retry(request: typeof bookingRequest) {
      if (!intent?.uncertain) throw new BookingSubmissionPendingError();
      return run(intent, request);
    },
  };
}
