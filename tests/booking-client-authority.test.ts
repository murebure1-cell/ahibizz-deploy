import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createBookingPreviewApi } from "../src/components/preview/booking-preview-api";
import {
  BookingRequestError,
  bookingAccountId,
  bookingActorRequest,
  bookingWrite,
} from "../src/lib/booking-client";
import { createBookingSubmission } from "../src/lib/booking-submission";

const OWNER = "00100000-0000-4000-8000-000000000001";
const CUSTOMER = "00100000-0000-4000-8000-000000000002";
const denied = (error: unknown) =>
  error instanceof BookingRequestError &&
  error.status === 401 &&
  error.code === "ACCOUNT_IDENTITY_CHANGED";

test("private booking transport fails before dispatch without a valid expected account", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return {};
  };
  for (const id of [undefined, "", "actor/foreign", "a".repeat(129)])
    await assert.rejects(bookingActorRequest(id, request)("mine"), denied);
  assert.equal(calls, 0);
});

test("private booking binding keeps the exact mutation and overrides any supplied actor header", async () => {
  const key = randomUUID(),
    controller = new AbortController();
  const options = bookingWrite("POST", { expectedVersion: 1, action: "cancel" }, key);
  const original = new Headers(options.headers);
  original.set("X-AhiBizz-Account-ID", OWNER);
  await bookingActorRequest(CUSTOMER, async (path, value) => {
    assert.equal(path, "entries/fixture/action");
    const headers = new Headers(value?.headers);
    assert.equal(headers.get("X-AhiBizz-Account-ID"), CUSTOMER);
    assert.equal(headers.get("Idempotency-Key"), key);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(value?.method, "POST");
    assert.equal(value?.body, options.body);
    assert.equal(value?.signal, controller.signal);
    return {};
  })("entries/fixture/action", { ...options, headers: original, signal: controller.signal });
  assert.equal(original.get("X-AhiBizz-Account-ID"), OWNER, "Caller headers stay immutable.");
});

test("preview private reads and writes reject a changed cookie actor, while public reads stay anonymous", async () => {
  const api = createBookingPreviewApi();
  await assert.rejects(
    bookingActorRequest(CUSTOMER, api.ownerRequest)("mine/businesses/forma/settings"),
    denied,
  );
  await assert.rejects(bookingActorRequest(OWNER, api.customerRequest)("mine?page=1"), denied);
  await assert.rejects(
    api.ownerRequest("mine/businesses/forma/settings", {
      headers: { "X-AhiBizz-Account-ID": "invalid/actor" },
    }),
    (error) => error instanceof BookingRequestError && error.status === 400,
  );
  assert.equal(
    (
      await api.customerRequest("businesses/forma", {
        headers: { "X-AhiBizz-Account-ID": "invalid/actor" },
      })
    ).booking.enabled,
    true,
  );
});

test("an unknown customer request keeps its original account binding across later wrong-actor recovery", async () => {
  const api = createBookingPreviewApi({ now: () => new Date("2030-01-06T12:00:00Z") });
  const config = api.getConfig("forma"),
    service = config.services[0];
  assert.ok(service);
  const slots = await api.customerRequest(
    `businesses/forma/slots?serviceId=${service.id}&date=2030-01-07`,
  );
  const quote = {
    serviceId: service.id,
    startsAt: slots.slots[0].startsAt,
    configurationVersion: config.version,
  };
  const flow = createBookingSubmission("forma"),
    customer = bookingActorRequest(CUSTOMER, api.customerRequest);
  await assert.rejects(
    flow.submit(quote, async (path, options) => {
      await customer(path, options);
      throw new BookingRequestError("BOOKING_UNAVAILABLE", 503);
    }),
  );
  assert.equal(flow.uncertain, true);
  await assert.rejects(flow.retry(bookingActorRequest(CUSTOMER, api.ownerRequest)), denied);
  assert.equal(flow.uncertain, true);
  const entry = await flow.retry(customer);
  assert.equal(entry.customerId, CUSTOMER);
  assert.equal((await customer("mine?page=1")).entries.length, 1);
});

test("public booking resolves only the explicit current account and rejects malformed or unavailable identity", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input, "/api/account");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.redirect, "error");
      return Response.json({ account: { id: CUSTOMER } });
    },
  );
  assert.equal(await bookingAccountId(), CUSTOMER);
  fetch.mock.mockImplementationOnce(async () => Response.json({ account: { id: "bad/actor" } }));
  await assert.rejects(
    bookingAccountId(),
    (error) => error instanceof BookingRequestError && error.status === 503,
  );
  fetch.mock.mockImplementationOnce(async () =>
    Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 }),
  );
  await assert.rejects(
    bookingAccountId(),
    (error) => error instanceof BookingRequestError && error.code === "AUTHENTICATION_REQUIRED",
  );
});
