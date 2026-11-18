import assert from "node:assert/strict";
import test from "node:test";
import { BookingRequestError } from "../src/lib/booking-client";
import {
  createRentalSubmissions,
  type RentalIntent,
  RentalRecoveryRequired,
} from "../src/lib/rental-submission";
import type { RentalBooking, RentalRequestInput } from "../src/lib/rentals";

const rental: RentalIntent = {
  account: "renter-a",
  businessId: "69521117-22b4-4679-b4cc-ac4f53e65ad2",
  vehicleId: "76b9a6d0-e1d7-4124-ab0f-3da86c0cc3ca",
  vehicleName: "Golf",
  timezone: "Europe/Sarajevo",
  kind: "customer",
  body: {
    requestId: "8b4183f4-2440-45e2-81dd-695c91e50ec9",
    expectedVehicleVersion: 2,
    startsAt: "2027-03-27T11:30:00.000Z",
    endsAt: "2027-03-28T10:30:00.000Z",
  },
};
const receipt: RentalBooking = {
  id: "d5c33f26-c5d6-4932-935d-481a42e4b596",
  kind: "customer",
  businessId: rental.businessId,
  vehicleId: rental.vehicleId,
  vehicleName: rental.vehicleName,
  timezone: rental.timezone,
  startsAt: rental.body.startsAt,
  endsAt: rental.body.endsAt,
  customerName: "Gost",
  status: "requested",
  version: 1,
  businessTitle: "Test",
  totalMinor: 4590,
};

test("a lost rental response survives reload and retries only its original actor, times, vehicle version and id", async () => {
  const values = new Map<string, string>();
  const storage = () => ({
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, val: string) => {
      values.set(key, val);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  const sent: unknown[] = [];
  const dispatch = async (path: string, account: string, body: RentalRequestInput) => {
    sent.push([path, account, { ...body }]);
    if (sent.length === 1) throw Error("lost_after_commit");
    return { entry: receipt };
  };
  await assert.rejects(
    createRentalSubmissions(storage).submit(rental, dispatch),
    RentalRecoveryRequired,
  );
  const restored = createRentalSubmissions(storage);
  assert.deepEqual(restored.pending(rental.account), rental);
  assert.equal(restored.pending("different-account"), null);
  const changed = { ...rental, body: { ...rental.body, expectedVehicleVersion: 3 } };
  await assert.rejects(restored.submit(changed, dispatch), RentalRecoveryRequired);
  await assert.rejects(restored.retry({ ...rental, account: "different-account" }, dispatch));
  await assert.rejects(
    restored.retry(rental, async () => {
      throw new BookingRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
    }),
    RentalRecoveryRequired,
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(await restored.retry(changed, dispatch), receipt);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(createRentalSubmissions(storage).pending(rental.account), null);
  assert.equal(restored.previouslyUsed(), false);
});

test("declined rental commands unlock, incomplete or mismatched receipts require reconciliation", async () => {
  const store = createRentalSubmissions(() => null);
  const denied = async () => {
    throw new BookingRequestError("RENTAL_OVERLAP", 409);
  };
  await assert.rejects(store.submit(rental, denied), BookingRequestError);
  assert.equal(store.pending(rental.account), null);
  await assert.rejects(
    store.submit(rental, async () => ({ entry: { ...receipt, kind: "block" } })),
    RentalRecoveryRequired,
  );
  assert.deepEqual(store.pending(rental.account), rental);
  await assert.rejects(
    store.retry(rental, async () => {
      throw new BookingRequestError("VERSION_CONFLICT", 409);
    }),
    RentalRecoveryRequired,
  );
  await assert.rejects(
    store.retry(rental, async () => {
      throw new BookingRequestError("RENTAL_OFFER_VERSION_CHANGED", 409);
    }),
    BookingRequestError,
  );
  assert.equal(store.pending(rental.account), null);
});
