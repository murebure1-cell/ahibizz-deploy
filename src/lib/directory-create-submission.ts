import type { BusinessFields, DirectoryBusiness } from "../server/directory/types";

export class DirectoryRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super("Directory request failed.");
  }
}

type CreateFields = BusinessFields & { bookingEnabled?: boolean };
export type DirectoryCreateIntent = Readonly<{
  fields: Readonly<CreateFields>;
  body: string;
  key: string;
  publish: boolean;
}>;

export class DirectoryCreationPendingError extends Error {
  constructor() {
    super("The previous business creation must be verified first.");
  }
}

/** Keeps one create command until its outcome is known, for this mounted workspace only. */
export function createDirectoryCreation() {
  let intent: DirectoryCreateIntent | null = null;
  let uncertain = false;
  let running = false;

  return {
    get intent() {
      return intent;
    },
    retainUncertain() {
      // A concurrent denied read cannot prove the dispatched create did not commit.
      if (intent) uncertain = true;
      return intent;
    },
    begin(fields: CreateFields, publish: boolean): DirectoryCreateIntent {
      if (intent || running) throw new DirectoryCreationPendingError();
      const snapshot = Object.freeze({ ...fields });
      const { bookingEnabled: _booking, ...directoryFields } = snapshot;
      intent = Object.freeze({
        fields: snapshot,
        body: JSON.stringify(directoryFields),
        key: crypto.randomUUID(),
        publish,
      });
      uncertain = false;
      return intent;
    },
    async send(
      value: DirectoryCreateIntent,
      request: (options: RequestInit) => Promise<unknown>,
    ): Promise<DirectoryBusiness> {
      if (running || value !== intent) throw new DirectoryCreationPendingError();
      running = true;
      const wasUncertain = uncertain;
      try {
        const data = (await request({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": value.key,
            "X-AhiBizz-Paid-Draft": "1",
          },
          body: value.body,
        })) as { business?: DirectoryBusiness } | null;
        const business = data?.business;
        if (
          !business ||
          typeof business.id !== "string" ||
          !business.id ||
          !Number.isInteger(business.version) ||
          business.version < 1
        )
          throw new Error("unconfirmed_business_creation");
        intent = null;
        uncertain = false;
        return business;
      } catch (failure) {
        const rejected =
          failure instanceof DirectoryRequestError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408;
        if (rejected && !wasUncertain && !uncertain) {
          intent = null;
          uncertain = false;
        } else uncertain = true;
        throw failure;
      } finally {
        running = false;
      }
    },
  };
}
