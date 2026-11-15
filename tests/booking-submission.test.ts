import assert from "node:assert/strict";
import test from "node:test";
import { createBookingPreviewApi } from "../src/components/preview/booking-preview-api";
import type { BookingEntry, BookingSettings, BookingSlot } from "../src/lib/booking";
import { BookingRequestError, type bookingRequest, bookingWrite } from "../src/lib/booking-client";
import {
  type BookingQuote,
  BookingSubmissionBusyError,
  BookingSubmissionPendingError,
  createBookingSubmission,
} from "../src/lib/booking-submission";

async function fixture() {
  const api = createBookingPreviewApi({ now: () => new Date("2030-01-06T12:00:00.000Z") });
  const config = api.getConfig("forma");
  const service = config.services[0];
  assert.ok(service);
  const result = await api.customerRequest(
    `businesses/forma/slots?serviceId=${service.id}&date=2030-01-07`,
  );
  const slots = result.slots as BookingSlot[];
  const first = slots[0];
  assert.ok(first);
  const second = slots.find((slot) => slot.startsAt >= first.endsAt);
  assert.ok(second);
  const quote = (slot: BookingSlot): BookingQuote => ({
    serviceId: service.id,
    startsAt: slot.startsAt,
    configurationVersion: config.version,
  });
  const calls: { key: string | null; body: BodyInit | null | undefined }[] = [];
  const request: typeof bookingRequest = async (path, init) => {
    calls.push({ key: new Headers(init?.headers).get("Idempotency-Key"), body: init?.body });
    return api.customerRequest(path, init);
  };
  return { api, a: quote(first), b: quote(second), calls, request };
}

test("a lost booking acknowledgement locks new intent and exact-key retry recovers one stored request", async () => {
  const { api, a, b, calls, request } = await fixture();
  const flow = createBookingSubmission("forma");
  const providedQuote = { ...a };
  const lost: typeof bookingRequest = async (path, init) => {
    await request(path, init);
    throw new TypeError("The response was lost after the fixture committed.");
  };
  await assert.rejects(flow.submit(providedQuote, lost), TypeError);
  providedQuote.startsAt = b.startsAt;
  assert.equal(flow.uncertain, true);
  await assert.rejects(flow.submit(b, request), BookingSubmissionPendingError);
  assert.equal(calls.length, 1, "Changing selection must not create another request.");
  const original = (await api.customerRequest("mine?page=1")).entries as BookingEntry[];
  assert.equal(original.length, 1);
  const recovered = await flow.retry(request);
  assert.equal(recovered.id, original[0]?.id);
  assert.equal(recovered.startsAt, a.startsAt, "Caller mutation cannot replace the stored quote.");
  assert.equal(flow.uncertain, false);
  assert.equal(new Set(calls.map((call) => call.key)).size, 1);
  assert.equal(new Set(calls.map((call) => call.body)).size, 1);
  assert.equal(((await api.customerRequest("mine?page=1")).entries as BookingEntry[]).length, 1);
  await flow.submit(b, request);
  assert.equal(((await api.customerRequest("mine?page=1")).entries as BookingEntry[]).length, 2);
  assert.notEqual(calls[2]?.key, calls[0]?.key, "A new request is allowed after reconciliation.");
});

test("a later authorization failure cannot erase an earlier unknown committed intent", async () => {
  const { api, a, b, calls, request } = await fixture();
  const flow = createBookingSubmission("forma");
  await assert.rejects(
    flow.submit(a, async (path, init) => {
      await request(path, init);
      throw new BookingRequestError("BOOKING_UNAVAILABLE", 503);
    }),
  );
  await assert.rejects(
    flow.retry(async () => {
      throw new BookingRequestError("AUTHENTICATION_REQUIRED", 401);
    }),
  );
  assert.equal(flow.uncertain, true);
  await assert.rejects(flow.submit(b, request), BookingSubmissionPendingError);
  const recovered = await flow.retry(request);
  assert.equal(recovered.startsAt, a.startsAt);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.equal(((await api.customerRequest("mine?page=1")).entries as BookingEntry[]).length, 1);
});

test("owner offer changes preserve the original committed quote during uncertain recovery", async () => {
  const { api, a, calls, request } = await fixture();
  const flow = createBookingSubmission("forma");
  await assert.rejects(
    flow.submit(a, async (path, init) => {
      await request(path, init);
      throw new TypeError("Response lost after commit.");
    }),
  );
  const original = ((await api.customerRequest("mine?page=1")).entries as BookingEntry[])[0];
  assert.ok(original);
  const settings = (await api.ownerRequest("mine/businesses/forma/settings"))
    .settings as BookingSettings;
  const { version, ...fields } = settings;
  await api.ownerRequest(
    "mine/businesses/forma/settings",
    bookingWrite("PATCH", {
      ...fields,
      expectedVersion: version,
      services: fields.services.map((service) => ({
        ...service,
        priceMinor: service.priceMinor + 100,
      })),
    }),
  );
  const recovered = await flow.retry(request);
  assert.equal(recovered.id, original.id);
  assert.equal(recovered.priceMinor, original.priceMinor);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.equal(calls[0]?.body, calls[1]?.body);
  assert.equal(((await api.customerRequest("mine?page=1")).entries as BookingEntry[]).length, 1);
  assert.equal(flow.uncertain, false);
});

test("an authoritative first-attempt configuration rejection permits a fresh quote", async () => {
  const { api, a, calls, request } = await fixture();
  const flow = createBookingSubmission("forma");
  await assert.rejects(
    flow.submit({ ...a, configurationVersion: a.configurationVersion + 1 }, request),
    (failure) =>
      failure instanceof BookingRequestError && failure.code === "BOOKING_CONFIGURATION_CHANGED",
  );
  assert.equal(flow.uncertain, false);
  assert.equal(((await api.customerRequest("mine?page=1")).entries as BookingEntry[]).length, 0);
  const entry = await flow.submit(a, request);
  assert.equal(entry.startsAt, a.startsAt);
  assert.notEqual(calls[0]?.key, calls[1]?.key);
});

test("a mismatched acknowledgement stays uncertain and retry reads the real stored status", async () => {
  const { api, a, b, request } = await fixture();
  const flow = createBookingSubmission("forma");
  await assert.rejects(
    flow.submit(a, async (path, init) => {
      const data = await request(path, init);
      return { ...data, entry: { ...data.entry, startsAt: b.startsAt } };
    }),
    /unconfirmed_booking_request/,
  );
  assert.equal(flow.uncertain, true);
  const entry = ((await api.customerRequest("mine?page=1")).entries as BookingEntry[])[0];
  assert.ok(entry);
  await api.ownerRequest(
    `entries/${entry.id}/action`,
    bookingWrite("POST", { expectedVersion: entry.version, action: "decline" }),
  );
  const recovered = await flow.retry(request);
  assert.equal(recovered.id, entry.id);
  assert.equal(recovered.status, "declined");
  assert.equal(flow.uncertain, false);
});

test("an in-flight booking cannot be replaced by a second selection", async () => {
  const { api, a, b, calls, request } = await fixture();
  const flow = createBookingSubmission("forma");
  let release: (() => void) | undefined;
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = flow.submit(a, async (path, init) => {
    const data = await request(path, init);
    await acknowledgement;
    return data;
  });
  await assert.rejects(flow.submit(b, request), BookingSubmissionBusyError);
  assert.ok(release);
  release();
  const recovered = await pending;
  assert.equal(recovered.startsAt, a.startsAt);
  assert.equal(calls.length, 1);
  assert.equal(((await api.customerRequest("mine?page=1")).entries as BookingEntry[]).length, 1);
});

test("a request timeout remains uncertain instead of treating a proxy response as rejection", async () => {
  const { a, b, request } = await fixture();
  const flow = createBookingSubmission("forma");
  await assert.rejects(
    flow.submit(a, async () => {
      throw new BookingRequestError("BOOKING_UNAVAILABLE", 408);
    }),
  );
  assert.equal(flow.uncertain, true);
  await assert.rejects(flow.submit(b, request), BookingSubmissionPendingError);
});
