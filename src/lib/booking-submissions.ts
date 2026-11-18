import { BookingRequestError } from "./booking-client";

export type SubmissionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> &
  Partial<Pick<Storage, "key" | "length">>;
export const submissionUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const receiptStatuses = ["requested", "confirmed", "cancelled", "declined"];

export function createBookingSubmissions<
  Intent extends {
    account: string;
    businessId: string;
    kind: "customer" | "block";
    body: { requestId: string };
  },
  Receipt,
>({
  domain,
  storage,
  isValid,
  resourceId,
  matches,
  uncertain,
  definitiveOnRetry,
}: {
  domain: "stay" | "rental";
  storage: () => SubmissionStorage | null;
  isValid: (intent: Intent) => boolean;
  resourceId: (intent: Intent) => string;
  matches: (intent: Intent, receipt: Receipt) => boolean;
  uncertain: (intent: Intent) => Error;
  definitiveOnRetry: (code: string) => boolean;
}) {
  type Write = (path: string, account: string, body: Intent["body"]) => Promise<{ entry: Receipt }>;
  const memory = new Map<string, Intent>(),
    inFlight = new Set<string>();
  const prefix = `ahibizz.${domain}.pending.v1.`;
  const marker = `ahibizz.${domain}.recovery.v1`;
  const key = (account: string) => prefix + account;
  function pending(account: string) {
    const known = memory.get(account);
    if (known) return known;
    try {
      const encoded = storage()?.getItem(key(account));
      if (!encoded) return null;
      const item = JSON.parse(encoded) as Intent;
      if (item.account !== account || !isValid(item)) return null;
      memory.set(account, item);
      return item;
    } catch {
      return null;
    }
  }
  function forget(account: string) {
    memory.delete(account);
    try {
      const session = storage();
      session?.removeItem(key(account));
      // Avoid an account lookup on every future public visit after the last receipt.
      if (!session?.key || session.length === undefined) return;
      for (let i = 0; i < session.length; i++) {
        if (session.key(i)?.startsWith(prefix)) return;
      }
      session.removeItem(marker);
    } catch {}
  }
  async function run(intent: Intent, write: Write, retry: boolean) {
    const { account, businessId, kind, body } = intent;
    if (inFlight.has(account)) throw uncertain(intent);
    inFlight.add(account);
    memory.set(account, intent);
    try {
      const session = storage();
      session?.setItem(key(account), JSON.stringify(intent));
      session?.setItem(marker, "1");
    } catch {}
    try {
      const data = await write(
        `${kind === "block" ? "block" : "request"}/${businessId}/${resourceId(intent)}`,
        account,
        body,
      );
      if (!data?.entry || !matches(intent, data.entry)) throw Error("invalid_booking_receipt");
      forget(account);
      return data.entry;
    } catch (e) {
      if (
        e instanceof BookingRequestError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        (!retry || definitiveOnRetry(e.code))
      ) {
        forget(account);
        throw e;
      }
      throw uncertain(intent);
    } finally {
      inFlight.delete(account);
    }
  }
  return {
    pending,
    previouslyUsed() {
      if (memory.size) return true;
      try {
        return storage()?.getItem(marker) === "1";
      } catch {
        return false;
      }
    },
    async submit(intent: Intent, write: Write) {
      const previous = pending(intent.account);
      if (previous) throw uncertain(previous);
      return run(intent, write, false);
    },
    async retry(intent: Intent, write: Write) {
      const previous = pending(intent.account);
      if (!previous || previous.body.requestId !== intent.body.requestId)
        throw new Error("booking_request_changed");
      return run(previous, write, true);
    },
  };
}
