import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createBookingPreviewApi } from "../src/components/preview/booking-preview-api";
import type { BookingEntry, BookingSettings, BookingSlot } from "../src/lib/booking";
import { BookingRequestError, bookingWrite } from "../src/lib/booking-client";

const date = "2030-01-07"; // Monday, inside the explicit Monday–Saturday fixture schedule.
const calendar =
  "mine/businesses/forma/calendar?from=2030-01-01T00%3A00%3A00Z&to=2030-02-01T00%3A00%3A00Z";
function fixture() {
  let clock = new Date("2030-01-06T12:00:00.000Z");
  const api = createBookingPreviewApi({ now: () => clock });
  const service = api.getConfig().services[0];
  assert.ok(service);
  return {
    api,
    service,
    setClock(value: string) {
      clock = new Date(value);
    },
    async slots() {
      const result = await api.customerRequest(
        `businesses/forma/slots?serviceId=${service.id}&date=${date}`,
      );
      return result.slots as BookingSlot[];
    },
    async create(
      slot: BookingSlot,
      key = randomUUID(),
      configurationVersion = api.getConfig().version,
    ) {
      const result = await api.customerRequest(
        "businesses/forma/requests",
        bookingWrite(
          "POST",
          { serviceId: service.id, startsAt: slot.startsAt, configurationVersion },
          key,
        ),
      );
      return result.entry as BookingEntry;
    },
  };
}
function error(code: string, status: number) {
  return (failure: unknown) =>
    failure instanceof BookingRequestError && failure.code === code && failure.status === status;
}

test("preview request holds all services; owner approval and customer cancellation release the same slot", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("No network is allowed in booking fixtures.");
  });
  const f = fixture(),
    { api } = f;
  const [slot] = await f.slots();
  assert.ok(slot);
  let notifications = 0;
  const initialRevision = api.snapshotVersion(),
    unsubscribe = api.subscribe(() => {
      notifications++;
    });
  const key = randomUUID(),
    entry = await f.create(slot, key);
  assert.match(entry.id, /^[a-f\d-]{36}$/);
  assert.equal(entry.status, "requested");
  assert.equal(
    (await f.slots()).some((item) => item.startsAt === slot.startsAt),
    false,
  );
  const second = api.getConfig().services[1];
  assert.ok(second);
  const otherService = await api.customerRequest(
    `businesses/forma/slots?serviceId=${second.id}&date=${date}`,
  );
  assert.equal(
    otherService.slots.some((item: BookingSlot) => item.startsAt === slot.startsAt),
    false,
  );
  const approved = await api.ownerRequest(
    `entries/${entry.id}/action`,
    bookingWrite("POST", { expectedVersion: 1, action: "approve" }),
  );
  assert.equal(approved.entry.status, "confirmed");
  const mine = await api.customerRequest("mine?page=1");
  assert.equal(mine.entries[0].id, entry.id);
  assert.equal(mine.entries[0].version, 2);
  const cancelled = await api.customerRequest(
    `entries/${entry.id}/action`,
    bookingWrite("POST", { expectedVersion: 2, action: "cancel" }),
  );
  assert.equal(cancelled.entry.status, "cancelled");
  assert.equal((await api.customerRequest("mine?view=upcoming")).entries.length, 0);
  assert.equal((await api.customerRequest("mine?view=history")).entries[0].id, entry.id);
  assert.equal(
    (await f.slots()).some((item) => item.startsAt === slot.startsAt),
    true,
  );
  assert.equal(
    (await f.create(slot, key)).status,
    "cancelled",
    "create replay returns the current entry",
  );
  assert.equal((await api.ownerRequest(calendar)).entries.length, 1);
  assert.equal(api.snapshotVersion(), initialRevision + 3);
  assert.equal(notifications, 3, "reads and replay do not announce phantom mutations");
  unsubscribe();
  assert.equal(fetch.mock.callCount(), 0);
});

test("preview configuration CAS protects selected quotes and retains existing booking snapshots", async () => {
  const f = fixture(),
    { api } = f,
    [slot] = await f.slots();
  assert.ok(slot);
  const key = randomUUID(),
    entry = await f.create(slot, key),
    quote = api.getConfig().version;
  const settings = (await api.ownerRequest("mine/businesses/forma/settings"))
    .settings as BookingSettings;
  const change = {
    ...settings,
    expectedVersion: settings.version,
    services: settings.services.map((service) => ({
      ...service,
      priceMinor: service.priceMinor + 100,
    })),
  };
  const { version: _version, ...body } = change;
  const saved = await api.ownerRequest(
    "mine/businesses/forma/settings",
    bookingWrite("PATCH", body),
  );
  assert.equal(saved.settings.version, quote + 1);
  await assert.rejects(
    api.ownerRequest("mine/businesses/forma/settings", bookingWrite("PATCH", body)),
    error("VERSION_CONFLICT", 409),
  );
  const next = (await f.slots())[0];
  assert.ok(next);
  await assert.rejects(
    f.create(next, randomUUID(), quote),
    error("BOOKING_CONFIGURATION_CHANGED", 409),
  );
  assert.equal((await f.create(slot, key, quote)).priceMinor, entry.priceMinor);
  await assert.rejects(f.create(next, key, quote + 1), error("IDEMPOTENCY_CONFLICT", 409));
  const current = (await api.ownerRequest("mine/businesses/forma/settings"))
    .settings as BookingSettings;
  const { version, ...fields } = current;
  await assert.rejects(
    api.ownerRequest(
      "mine/businesses/forma/settings",
      bookingWrite("PATCH", { ...fields, expectedVersion: version, timezone: "UTC" }),
    ),
    error("BOOKING_TIMEZONE_IN_USE", 409),
  );
  assert.equal(api.getConfig().timezone, "Europe/Sarajevo");
  const otherId = "preview-business-1";
  api.registerBusiness(otherId, "Ogledni posao");
  await assert.rejects(
    api.ownerRequest(
      `mine/businesses/${otherId}/settings`,
      bookingWrite("PATCH", { ...body, expectedVersion: 0 }),
    ),
    error("INVALID_BOOKING_INPUT", 400),
  );
  assert.equal(api.getConfig(otherId).version, 0, "failed settings save stays atomic");
});

test("preview credits require an approved customer appointment, elapsed end and one completion", async () => {
  const f = fixture(),
    { api } = f,
    [slot] = await f.slots();
  assert.ok(slot);
  const entry = await f.create(slot);
  const move = (id: string, expectedVersion: number, action: string) =>
    api.ownerRequest(`entries/${id}/action`, bookingWrite("POST", { expectedVersion, action }));
  assert.equal((await api.ownerRequest(calendar)).earnedCredits, 0);
  await assert.rejects(move(entry.id, 1, "complete"), error("INVALID_BOOKING_TRANSITION", 409));
  await move(entry.id, 1, "approve");
  assert.equal((await api.ownerRequest(calendar)).earnedCredits, 0);
  await assert.rejects(move(entry.id, 2, "complete"), error("INVALID_BOOKING_TRANSITION", 409));
  f.setClock(slot.endsAt);
  await move(entry.id, 2, "complete");
  assert.equal((await api.ownerRequest(calendar)).earnedCredits, 5);
  assert.equal((await api.ownerRequest("mine")).credits, 5);
  assert.equal((await api.customerRequest("mine")).credits, 0);
  await assert.rejects(move(entry.id, 2, "complete"), error("VERSION_CONFLICT", 409));
  await assert.rejects(move(entry.id, 3, "complete"), error("INVALID_BOOKING_TRANSITION", 409));
  const manual = await api.ownerRequest(
    "mine/businesses/forma/entries",
    bookingWrite(
      "POST",
      {
        kind: "manual",
        serviceId: f.service.id,
        startsAt: "2030-01-07T18:00:00.000Z",
        clientName: "Ogledna osoba",
      },
      randomUUID(),
    ),
  );
  f.setClock(manual.entry.endsAt);
  await move(manual.entry.id, 1, "complete");
  assert.equal(
    (await api.ownerRequest(calendar)).earnedCredits,
    5,
    "manual appointments never earn credits",
  );
  const block = await api.ownerRequest(
    "mine/businesses/forma/entries",
    bookingWrite(
      "POST",
      { kind: "block", startsAt: "2030-01-08T18:00:00.000Z", endsAt: "2030-01-08T19:00:00.000Z" },
      randomUUID(),
    ),
  );
  f.setClock(block.entry.endsAt);
  await assert.rejects(
    move(block.entry.id, 1, "complete"),
    error("INVALID_BOOKING_TRANSITION", 409),
  );
  assert.equal((await api.ownerRequest(calendar)).earnedCredits, 5);
});

test("preview draft settings begin disabled, reads are isolated copies and disabled public booking still permits private blocks", async () => {
  const { api } = fixture();
  assert.deepEqual(api.getConfig("unknown").services, []);
  assert.equal(api.getConfig("unknown").enabled, false);
  api.registerBusiness("preview-business-1", "Novi ogledni posao");
  const draft = (await api.ownerRequest("mine/businesses/preview-business-1/settings")).settings;
  assert.equal(draft.version, 0);
  assert.equal(draft.enabled, false);
  await api.ownerRequest(
    "mine/businesses/preview-business-1/settings",
    bookingWrite("PATCH", {
      expectedVersion: 0,
      enabled: true,
      timezone: draft.timezone,
      windows: [],
      services: [],
    }),
  );
  assert.equal(api.getSettings("preview-business-1").enabled, true);
  assert.equal(
    api.getConfig("preview-business-1").enabled,
    false,
    "public readiness is distinct from owner opt-in",
  );
  const ownerSettings = api.getSettings("preview-business-1");
  ownerSettings.enabled = false;
  assert.equal(
    api.getSettings("preview-business-1").enabled,
    true,
    "owner selector also returns an isolated copy",
  );
  const settings = (await api.ownerRequest("mine/businesses/forma/settings"))
    .settings as BookingSettings;
  const service = settings.services[0];
  assert.ok(service);
  service.priceMinor = 999;
  assert.notEqual(api.getConfig().services[0]?.priceMinor, 999);
  const { version, ...fields } = settings;
  await api.ownerRequest(
    "mine/businesses/forma/settings",
    bookingWrite("PATCH", { ...fields, expectedVersion: version, enabled: false }),
  );
  assert.equal(api.getConfig().enabled, false);
  assert.deepEqual(api.getConfig().services, []);
  const created = await api.ownerRequest(
    "mine/businesses/forma/entries",
    bookingWrite(
      "POST",
      { kind: "block", startsAt: "2030-01-07T08:00:00Z", endsAt: "2030-01-07T09:00:00Z" },
      randomUUID(),
    ),
  );
  assert.equal(created.entry.kind, "block");
  assert.equal(created.entry.clientEmail, null);
});

test("preview transport rejects external paths, unknown/private access, aborted writes and unsupported parameters without fetching", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected network.");
  });
  const { api } = fixture();
  await assert.rejects(
    api.customerRequest("https://example.com/api"),
    error("INVALID_BOOKING_INPUT", 400),
  );
  await assert.rejects(api.customerRequest("businesses/unknown"), error("BUSINESS_NOT_FOUND", 404));
  await assert.rejects(
    api.customerRequest("mine/businesses/forma/settings"),
    error("OWNER_REQUIRED", 403),
  );
  await assert.rejects(
    api.customerRequest("mine?page=1&page=2"),
    error("INVALID_BOOKING_INPUT", 400),
  );
  await assert.rejects(
    api.customerRequest("mine?ownerId=other"),
    error("INVALID_BOOKING_INPUT", 400),
  );
  for (const path of ["mine?view=all", "mine?view=upcoming&view=history", "mine?view="])
    await assert.rejects(api.customerRequest(path), error("INVALID_BOOKING_INPUT", 400));
  const controller = new AbortController();
  controller.abort();
  const before = api.snapshotVersion();
  await assert.rejects(
    api.ownerRequest("mine/businesses/forma/settings", {
      ...bookingWrite("PATCH", {}),
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(api.snapshotVersion(), before);
  assert.equal(fetch.mock.callCount(), 0);
});

test("preview appointments put the nearest active booking first and keep every other entry in history", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("No network is allowed in booking fixtures.");
  });
  const f = fixture(),
    { api } = f,
    { version, ...fields } = api.getSettings();
  await api.ownerRequest(
    "mine/businesses/forma/settings",
    bookingWrite("PATCH", {
      ...fields,
      expectedVersion: version,
      timezone: "UTC",
      windows: Array.from({ length: 7 }, (_, index) => ({
        weekday: index + 1,
        startMinute: 540,
        endMinute: 1020,
      })),
    }),
  );
  f.setClock("2030-01-20T12:00:00.000Z");
  const entries: BookingEntry[] = [];
  for (let index = 0; index < 30; index++) {
    const startsAt = `2030-01-${21 + Math.floor(index / 6)}T${String(9 + (index % 6)).padStart(2, "0")}:00:00.000Z`;
    entries.push(
      await f.create({
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 45 * 60_000).toISOString(),
      }),
    );
  }
  for (const index of [1, 2, 3, 4]) {
    const entry = entries[index];
    assert.ok(entry);
    entries[index] = (
      await api.ownerRequest(
        `entries/${entry.id}/action`,
        bookingWrite("POST", {
          expectedVersion: entry.version,
          action: "approve",
        }),
      )
    ).entry;
  }
  for (const [index, action] of [
    [28, "cancel"],
    [29, "decline"],
  ] as const) {
    const entry = entries[index];
    assert.ok(entry);
    entries[index] = (
      await api.ownerRequest(
        `entries/${entry.id}/action`,
        bookingWrite("POST", {
          expectedVersion: entry.version,
          action,
        }),
      )
    ).entry;
  }
  const completed = entries[2];
  assert.ok(completed);
  f.setClock(completed.endsAt);
  entries[2] = (
    await api.ownerRequest(
      `entries/${completed.id}/action`,
      bookingWrite("POST", {
        expectedVersion: completed.version,
        action: "complete",
      }),
    )
  ).entry;
  f.setClock("2030-01-21T12:45:00.000Z");
  const current = await api.customerRequest("mine?view=upcoming&page=1"),
    second = await api.customerRequest("mine?view=upcoming&page=2"),
    history = await api.customerRequest("mine?view=history"),
    original = await api.customerRequest("mine?page=1");
  assert.equal(current.asOf, "2030-01-21T12:45:00.000Z");
  assert.equal(current.view, "upcoming");
  assert.equal(current.entries.length, 20);
  assert.equal(current.hasMore, true);
  assert.equal(second.hasMore, false);
  assert.deepEqual(
    [...current.entries, ...second.entries].map((entry: BookingEntry) => entry.id),
    entries.slice(4, 28).map((entry) => entry.id),
  );
  assert.deepEqual(
    history.entries.map((entry: BookingEntry) => entry.id),
    [entries[29], entries[28], ...entries.slice(0, 4).toReversed()].map((entry) => entry?.id),
  );
  assert.equal(
    new Set(
      [...current.entries, ...second.entries, ...history.entries].map(
        (entry: BookingEntry) => entry.id,
      ),
    ).size,
    30,
  );
  assert.equal(
    original.entries[0].id,
    entries[29]?.id,
    "Requests without a view retain the legacy descending order.",
  );
  assert.equal((await api.ownerRequest("mine?view=upcoming")).entries.length, 0);
  assert.equal((await api.ownerRequest("mine?view=history")).entries.length, 0);
  f.setClock("2030-01-21T13:15:00.000Z");
  assert.equal(
    (await api.customerRequest("mine?view=upcoming")).entries[0].id,
    entries[4]?.id,
    "The appointment in progress stays visible.",
  );
  f.setClock("2030-01-21T13:45:00.000Z");
  assert.equal(
    (await api.customerRequest("mine?view=history")).entries.some(
      (entry: BookingEntry) => entry.id === entries[4]?.id,
    ),
    true,
  );
  assert.equal(
    (await api.customerRequest("mine?view=upcoming")).entries.some(
      (entry: BookingEntry) => entry.id === entries[4]?.id,
    ),
    false,
  );
  f.setClock("2030-01-26T00:00:00.000Z");
  const older = await api.customerRequest("mine?view=history&page=1"),
    oldest = await api.customerRequest("mine?view=history&page=2");
  assert.equal(older.hasMore, true);
  assert.equal(oldest.hasMore, false);
  assert.deepEqual(
    [...older.entries, ...oldest.entries].map((entry: BookingEntry) => entry.id),
    entries.toReversed().map((entry) => entry.id),
    "Expired active entries remain reachable through every history page.",
  );
  assert.equal((await api.customerRequest("mine?view=upcoming")).entries.length, 0);
  assert.equal(fetch.mock.callCount(), 0);
});
