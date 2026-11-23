import assert from "node:assert/strict";
import test from "node:test";
import { createBookingPreviewApi } from "../src/components/preview/booking-preview-api";
import type { BookingSlot } from "../src/lib/booking";
import { BookingRequestError, bookingWrite } from "../src/lib/booking-client";
import {
  type CustomerAppointmentsState,
  customerAppointmentCancelled,
  customerAppointmentsFailed,
  readCustomerCancellation,
  reconcileCustomerCancellations,
} from "../src/lib/customer-appointments-state";

async function loadedAppointments(): Promise<CustomerAppointmentsState> {
  const api = createBookingPreviewApi({ now: () => new Date("2030-01-06T12:00:00Z") });
  const config = api.getConfig("forma");
  const service = config.services[0];
  assert.ok(service);
  const available = await api.customerRequest(
    `businesses/forma/slots?serviceId=${service.id}&date=2030-01-07`,
  );
  const slot = (available.slots as BookingSlot[])[0];
  assert.ok(slot);
  await api.customerRequest(
    "businesses/forma/requests",
    bookingWrite(
      "POST",
      {
        serviceId: service.id,
        startsAt: slot.startsAt,
        configurationVersion: config.version,
      },
      crypto.randomUUID(),
    ),
  );
  const page = await api.customerRequest("mine?page=1&view=upcoming");
  assert.equal(page.entries.length, 1);
  return {
    result: {
      key: "upcoming:1",
      entries: page.entries,
      more: page.hasMore,
    },
    requiresLogin: false,
  };
}

test("authoritative 401 and 403 remove previously loaded private appointments and action targets", async () => {
  const loaded = await loadedAppointments();
  for (const [status, code] of [
    [401, "AUTHENTICATION_REQUIRED"],
    [403, "ACCOUNT_SUSPENDED"],
  ] as const) {
    const denied = customerAppointmentsFailed(loaded, new BookingRequestError(code, status));
    assert.equal(denied.result, null, "No cached entry or cancel target remains renderable.");
    assert.equal(denied.requiresLogin, true);
    assert.equal(loaded.result?.entries.length, 1, "The old snapshot is not mutated.");
    const laterOutage = customerAppointmentsFailed(
      denied,
      new BookingRequestError("BOOKING_UNAVAILABLE", 503),
    );
    assert.equal(laterOutage.result, null, "A later outage cannot restore revoked private data.");
    assert.equal(laterOutage.requiresLogin, true);
  }
});

test("a transient 503 or lost connection retains a previously accepted appointment page", async () => {
  const loaded = await loadedAppointments();
  for (const failure of [
    new BookingRequestError("BOOKING_UNAVAILABLE", 503),
    new TypeError("The connection was lost."),
  ]) {
    const next = customerAppointmentsFailed(loaded, failure);
    assert.equal(next, loaded);
    assert.equal(next.result?.entries.length, 1);
    assert.equal(next.result?.entries[0]?.status, "requested");
    assert.equal(next.requiresLogin, false);
  }
});

async function cancellationFixture() {
  const loaded = await loadedAppointments();
  const entry = loaded.result?.entries[0];
  assert.ok(entry?.customerId);
  const cancelled = readCustomerCancellation(
    { ...entry, status: "cancelled", version: entry.version + 1 },
    entry,
    entry.customerId,
  );
  return { loaded, entry, cancelled };
}

test("confirmed cancellation removes the upcoming action before a fallible refresh", async () => {
  const { loaded, entry, cancelled } = await cancellationFixture();
  const corrected = customerAppointmentCancelled(loaded, cancelled);
  assert.equal(corrected.result?.entries.length, 0);
  assert.equal(corrected.result?.key, loaded.result?.key);
  assert.equal(corrected.result?.more, loaded.result?.more);
  assert.equal(loaded.result?.entries[0], entry, "The accepted source snapshot is not mutated.");
  assert.equal(entry.status, "requested");
  for (const failure of [
    new BookingRequestError("BOOKING_UNAVAILABLE", 503),
    new TypeError("offline"),
  ])
    assert.equal(customerAppointmentsFailed(corrected, failure), corrected);
});

test("history adopts the confirmed version but cancellation cannot resurrect denied or absent pages", async () => {
  const { loaded, cancelled } = await cancellationFixture();
  assert.ok(loaded.result);
  const history = { ...loaded, result: { ...loaded.result, key: "history:1" } };
  const corrected = customerAppointmentCancelled(history, cancelled);
  assert.equal(corrected.result?.entries[0]?.status, "cancelled");
  assert.equal(corrected.result?.entries[0]?.version, cancelled.version);
  const denied = customerAppointmentsFailed(
    history,
    new BookingRequestError("ACCOUNT_SUSPENDED", 403),
  );
  assert.equal(customerAppointmentCancelled(denied, cancelled), denied);
  const empty: CustomerAppointmentsState = { result: null, requiresLogin: false };
  assert.equal(customerAppointmentCancelled(empty, cancelled), empty);
});

test("a cancellation acknowledgement must belong to the original actor and immutable appointment quote", async () => {
  const { entry, cancelled } = await cancellationFixture();
  for (const value of [
    null,
    { ...cancelled, id: "other" },
    { ...cancelled, businessId: "other" },
    { ...cancelled, customerId: "other" },
    { ...cancelled, kind: "manual" },
    { ...cancelled, status: "confirmed" },
    { ...cancelled, version: entry.version },
    { ...cancelled, version: 2147483648 },
    { ...cancelled, version: 2.5 },
    { ...cancelled, priceMinor: entry.priceMinor + 1 },
    { ...cancelled, serviceName: "Changed quote" },
    { ...cancelled, startsAt: "2031-01-01T00:00:00Z" },
  ])
    assert.throws(() => readCustomerCancellation(value, entry, entry.customerId ?? undefined));
  assert.throws(() => readCustomerCancellation(cancelled, entry, "another-actor"));
  assert.throws(() => readCustomerCancellation(cancelled, entry, undefined));
});

test("terminal cancellation snapshots reject regression and reconcile late list versions monotonically", async () => {
  const { loaded, entry, cancelled } = await cancellationFixture();
  assert.ok(loaded.result);
  const page = loaded.result;
  const known = [cancelled];
  assert.deepEqual(reconcileCustomerCancellations(loaded.result, known).entries, []);
  const history = reconcileCustomerCancellations({ ...loaded.result, key: "history:1" }, known);
  assert.deepEqual(history.entries, [cancelled]);
  const newer = { ...cancelled, version: cancelled.version + 1 };
  const current = { ...loaded, result: { ...loaded.result, key: "history:1", entries: [newer] } };
  assert.equal(customerAppointmentCancelled(current, cancelled), current);
  assert.deepEqual(reconcileCustomerCancellations(current.result, known).entries, [newer]);
  assert.throws(() =>
    reconcileCustomerCancellations(
      { ...page, entries: [{ ...entry, version: cancelled.version + 1 }] },
      known,
    ),
  );
  assert.throws(() =>
    reconcileCustomerCancellations(
      { ...page, entries: [{ ...entry, customerId: "another-actor" }] },
      known,
    ),
  );
});
