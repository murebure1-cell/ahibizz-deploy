import { BookingRequestError } from "./booking-client";
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
type Write = (
  path: string,
  account: string,
  body: StayRequestInput,
) => Promise<{ entry: StayBooking }>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createStaySubmissions(storage: () => StorageLike | null) {
  const memory = new Map<string, StayIntent>(),
    inFlight = new Set<string>();
  const key = (account: string) => `ahibizz.stay.pending.v1.${account}`;
  function pending(account: string) {
    const known = memory.get(account);
    if (known) return known;
    try {
      const encoded = storage()?.getItem(key(account));
      if (!encoded) return null;
      const item = JSON.parse(encoded) as StayIntent;
      const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      const date = /^\d{4}-\d\d-\d\d$/;
      if (
        item.account !== account ||
        !uuid.test(item.businessId) ||
        !uuid.test(item.unitId) ||
        !uuid.test(item.body.requestId) ||
        !Number.isSafeInteger(item.body.expectedUnitVersion) ||
        item.body.expectedUnitVersion < 1 ||
        !date.test(item.body.checkIn) ||
        !date.test(item.body.checkOut) ||
        item.body.checkIn >= item.body.checkOut ||
        (item.kind !== "customer" && item.kind !== "block")
      )
        return null;
      memory.set(account, item);
      return item;
    } catch {
      return null;
    }
  }
  function forget(account: string) {
    memory.delete(account);
    try {
      storage()?.removeItem(key(account));
    } catch {}
  }
  async function run(intent: StayIntent, write: Write, retry: boolean) {
    const { account, businessId, unitId, kind, body } = intent;
    if (inFlight.has(account)) throw new StayRecoveryRequired(intent);
    inFlight.add(account);
    memory.set(account, intent);
    try {
      const session = storage();
      session?.setItem(key(account), JSON.stringify(intent));
      session?.setItem("ahibizz.stay.recovery.v1", "1");
    } catch {}
    try {
      const data = await write(
        `${kind === "block" ? "block" : "request"}/${businessId}/${unitId}`,
        account,
        body,
      );
      if (
        !data?.entry?.id ||
        data.entry.businessId !== businessId ||
        data.entry.unitId !== unitId ||
        data.entry.kind !== kind ||
        data.entry.checkIn !== body.checkIn ||
        data.entry.checkOut !== body.checkOut ||
        !["requested", "confirmed", "cancelled", "declined"].includes(data.entry.status)
      )
        throw Error("invalid_stay_receipt");
      forget(account);
      return data.entry;
    } catch (e) {
      if (
        e instanceof BookingRequestError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        (!retry || e.code === "STAY_OVERLAP")
      ) {
        forget(account);
        throw e;
      }
      throw new StayRecoveryRequired(intent);
    } finally {
      inFlight.delete(account);
    }
  }
  return {
    pending,
    previouslyUsed() {
      if (memory.size) return true;
      try {
        return storage()?.getItem("ahibizz.stay.recovery.v1") === "1";
      } catch {
        return false;
      }
    },
    async submit(intent: StayIntent, write: Write) {
      const previous = pending(intent.account);
      if (previous) throw new StayRecoveryRequired(previous);
      return run(intent, write, false);
    },
    async retry(intent: StayIntent, write: Write) {
      const previous = pending(intent.account);
      if (!previous || previous.body.requestId !== intent.body.requestId)
        throw new Error("stay_request_changed");
      return run(previous, write, true);
    },
  };
}
export const staySubmissions = createStaySubmissions(() => window.sessionStorage);
