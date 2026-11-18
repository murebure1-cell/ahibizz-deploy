import assert from "node:assert/strict";
import test from "node:test";
import { BookingRequestError } from "../src/lib/booking-client";
import {
  createStaySubmissions,
  type StayIntent,
  StayRecoveryRequired,
} from "../src/lib/stay-submission";
import type { StayBooking, StayRequestInput } from "../src/lib/stays";

const original: StayIntent = {
  account: "guest-a",
  businessId: "a2ac2176-0fa8-4733-99f6-e4b97837f75a",
  unitId: "4997c987-8065-4840-bb94-f6cd8b134b39",
  kind: "customer",
  body: {
    checkIn: "2027-04-01",
    checkOut: "2027-04-03",
    expectedUnitVersion: 2,
    requestId: "d7145ddb-7949-48c5-a361-b203325c0976",
  },
};
const receipt: StayBooking = {
  id: "bde853ad-454f-4a08-aa04-edd17d59dc75",
  unitId: original.unitId,
  businessId: original.businessId,
  checkIn: original.body.checkIn,
  checkOut: original.body.checkOut,
  kind: "customer",
  status: "requested",
  version: 1,
  totalMinor: 20000,
  timezone: "Europe/Sarajevo",
  customerName: "Gost",
  businessTitle: "Pansion",
  unitName: "Soba",
};

test("a lost stay receipt survives remount and can only replay the exact account, unit, dates and request ID", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const first = createStaySubmissions(() => storage);
  const sent: unknown[] = [];
  const dispatch = async (path: string, actor: string, body: StayRequestInput) => {
    sent.push([path, actor, { ...body }]);
    if (sent.length === 1) throw Error("response_lost_after_commit");
    return { entry: receipt };
  };
  await assert.rejects(first.submit(original, dispatch), StayRecoveryRequired);
  const afterReload = createStaySubmissions(() => storage);
  assert.equal(afterReload.pending("guest-b"), null);
  const recovered = afterReload.pending(original.account);
  assert.deepEqual(recovered, original);
  const newIntent = {
    ...original,
    unitId: "be4f2136-c2ad-47eb-b9b1-9ed394decda6",
    body: { ...original.body, checkIn: "2027-04-05", checkOut: "2027-04-06" },
  };
  await assert.rejects(afterReload.submit(newIntent, dispatch), StayRecoveryRequired);
  assert.equal(sent.length, 1);
  await assert.rejects(
    afterReload.retry(original, async () => {
      throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
    }),
    StayRecoveryRequired,
  );
  assert.deepEqual((await afterReload.retry(original, dispatch)).id, receipt.id);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(afterReload.pending(original.account), null);
});
test("first definitive rejection frees the form, mismatched receipt preserves original intent", async () => {
  const op = createStaySubmissions(() => null);
  await assert.rejects(
    op.submit(original, async () => {
      throw new BookingRequestError("STAY_OVERLAP", 409);
    }),
    BookingRequestError,
  );
  assert.equal(op.pending(original.account), null);
  await assert.rejects(
    op.submit(original, async () => ({ entry: { ...receipt, checkIn: "2028-01-01" } })),
    StayRecoveryRequired,
  );
  assert.deepEqual(op.pending(original.account), original);
});
