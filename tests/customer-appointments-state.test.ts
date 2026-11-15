import assert from "node:assert/strict";
import test from "node:test";
import { createBookingPreviewApi } from "../src/components/preview/booking-preview-api";
import type { BookingSlot } from "../src/lib/booking";
import { BookingRequestError, bookingWrite } from "../src/lib/booking-client";
import {
  type CustomerAppointmentsState,
  customerAppointmentsFailed,
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
      credits: page.credits,
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
    assert.equal(
      denied.result,
      null,
      "No cached entry, credit or cancel target remains renderable.",
    );
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
