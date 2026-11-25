import assert from "node:assert/strict";
import test from "node:test";
import {
  type BusinessDetails,
  businessClosingMinute,
  businessOpenState,
  businessTimeLabel,
  emptyBusinessDetails,
  readBusinessDetails,
} from "../src/lib/business-details";
import { businessDetailsRequest } from "../src/lib/business-details-client";
import { DirectoryRequestError } from "../src/lib/directory-create-submission";
import { createBusinessDetailsHttpHandler } from "../src/server/business-details-http";
import { DirectoryAccessError } from "../src/server/directory/types";

function day(details: BusinessDetails, index: number) {
  const value = details.hours?.[index];
  assert.ok(value);
  return value;
}
const week = (timezone = "Europe/Sarajevo"): BusinessDetails => ({
  timezone,
  amenities: ["wifi", "parking"],
  hours: Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1,
    windows: index < 5 ? [{ startMinute: 540, endMinute: 1020 }] : [],
  })),
});

test("unknown business hours remain distinct from explicit seven-day closure", () => {
  assert.deepEqual(readBusinessDetails(emptyBusinessDetails()), {
    timezone: null,
    hours: null,
    amenities: [],
  });
  assert.equal(businessOpenState(emptyBusinessDetails(), new Date("2026-11-17T11:00Z")), null);
  const closed = week();
  closed.hours?.forEach((day) => {
    day.windows = [];
  });
  assert.equal(
    businessOpenState(readBusinessDetails(closed), new Date("2026-11-17T11:00Z")),
    "closed",
  );
  assert.deepEqual(
    readBusinessDetails({ ...emptyBusinessDetails(), amenities: ["family", "wifi"] }).amenities,
    ["wifi", "family"],
  );
});
test("hours validation rejects incomplete days, bad zones, overlaps and ambiguous overnight", () => {
  const invalid: unknown[] = [
    null,
    {},
    { ...week(), injected: true },
    { ...week(), timezone: "Not/AZone" },
    { ...week(), timezone: null },
    { ...week(), hours: null },
    { ...week(), hours: [] },
    { ...week(), amenities: ["wifi", "wifi"] },
    { ...week(), amenities: ["halal"] },
    { ...week(), amenities: ["<script>"] },
  ];
  for (const windows of [
    [{ startMinute: 600, endMinute: 500 }],
    [{ startMinute: -1, endMinute: 600 }],
    [{ startMinute: 0, endMinute: 1441 }],
    [{ startMinute: 1.5, endMinute: 500 }],
    [
      { startMinute: 500, endMinute: 700 },
      { startMinute: 600, endMinute: 800 },
    ],
    Array.from({ length: 5 }, (_, i) => ({ startMinute: i * 100, endMinute: i * 100 + 50 })),
  ]) {
    const details = week();
    day(details, 0).windows = windows;
    invalid.push(details);
  }
  const wrongDay = week();
  day(wrongDay, 1).weekday = 1;
  invalid.push(wrongDay);
  for (const value of invalid)
    assert.throws(() => readBusinessDetails(value), /INVALID_BUSINESS_DETAILS/);
});
test("multiple daily windows use half-open boundaries with no false open at lunch", () => {
  const value = week("UTC");
  day(value, 0).windows = [
    { startMinute: 540, endMinute: 720 },
    { startMinute: 780, endMinute: 1020 },
  ];
  const details = readBusinessDetails(value);
  for (const [time, expected] of [
    ["08:59", "closed"],
    ["09:00", "open"],
    ["11:59", "open"],
    ["12:00", "closed"],
    ["12:59", "closed"],
    ["13:00", "open"],
    ["17:00", "closed"],
  ])
    assert.equal(businessOpenState(details, new Date(`2026-11-16T${time}:00Z`)), expected);
});
test("an open business tells when its current window ends today", () => {
  const value = week("UTC");
  day(value, 0).windows = [
    { startMinute: 540, endMinute: 720 },
    { startMinute: 780, endMinute: 1440 },
  ];
  const details = readBusinessDetails(value);
  assert.equal(businessClosingMinute(details, new Date("2026-11-16T09:30:00Z")), 720);
  // Closed between the two windows, and a window that runs to midnight names no closing time.
  assert.equal(businessClosingMinute(details, new Date("2026-11-16T12:30:00Z")), null);
  assert.equal(businessClosingMinute(details, new Date("2026-11-16T20:00:00Z")), null);
  assert.equal(
    businessClosingMinute(emptyBusinessDetails(), new Date("2026-11-16T09:30:00Z")),
    null,
  );
});
test("real instant converts into business zone, not viewer timezone, across DST gaps/folds", () => {
  const value = week();
  day(value, 6).windows = [{ startMinute: 120, endMinute: 180 }];
  assert.equal(businessOpenState(value, new Date("2026-10-25T00:30:00Z")), "open");
  assert.equal(businessOpenState(value, new Date("2026-10-25T01:30:00Z")), "open");
  assert.equal(businessOpenState(value, new Date("2026-10-25T02:00:00Z")), "closed");
  assert.equal(businessOpenState(value, new Date("2026-03-29T00:59:00Z")), "closed");
  assert.equal(businessOpenState(value, new Date("2026-03-29T01:00:00Z")), "closed");
  assert.equal(
    businessOpenState(week("America/New_York"), new Date("2026-11-17T14:00:00Z")),
    "open",
  );
  assert.equal(
    businessOpenState(week("Pacific/Auckland"), new Date("2026-11-17T14:00:00Z")),
    "closed",
  );
  assert.equal(businessOpenState(value, new Date(Number.NaN)), null);
  assert.equal(businessOpenState({ ...value, timezone: "Invalid/Zone" }, new Date()), null);
});
test("overnight is explicit across two days, including Sunday→Monday", () => {
  const details = week("UTC");
  details.hours?.forEach((day) => {
    day.windows = [];
  });
  day(details, 6).windows = [{ startMinute: 1320, endMinute: 1440 }];
  day(details, 0).windows = [{ startMinute: 0, endMinute: 120 }];
  assert.equal(
    businessOpenState(readBusinessDetails(details), new Date("2026-11-22T23:59Z")),
    "open",
  );
  assert.equal(businessOpenState(details, new Date("2026-11-23T00:00Z")), "open");
  assert.equal(businessOpenState(details, new Date("2026-11-23T02:00Z")), "closed");
  assert.equal(businessTimeLabel(1440), "24:00");
});

const id = "44adf74e-cc83-43cc-b32d-1437845d86cb",
  baseURL = "https://details-fixture.invalid";
test("private details HTTP binds same-origin actor before body and rejects malformed/large input", async () => {
  let reads = 0,
    writes = 0;
  const service = {
    async readDetails() {
      reads++;
      return { id } as never;
    },
    async updateDetails() {
      writes++;
      return { id } as never;
    },
  };
  const handler = createBusinessDetailsHttpHandler({ service, baseURL });
  const send = (method = "GET", body?: string, extra: Record<string, string> = {}, suffix = "") =>
    handler(
      new Request(`${baseURL}/api/business-details/mine/${id}${suffix}`, {
        method,
        headers: {
          origin: baseURL,
          "X-AhiBizz-Account-ID": "fixture-member",
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body }),
      }),
    );
  assert.equal((await send()).status, 200);
  assert.equal((await send("GET", undefined, { origin: "https://elsewhere.invalid" })).status, 403);
  assert.equal((await send("GET", undefined, { "X-AhiBizz-Account-ID": "" })).status, 401);
  assert.equal((await send("GET", undefined, {}, "?unexpected=1")).status, 400);
  assert.equal((await send("POST", "{}")).status, 404);
  assert.equal((await send("PUT", "{}", { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await send("PUT", "{")).status, 400);
  assert.equal((await send("PUT", " ".repeat(16_385))).status, 413);
  assert.equal(writes, 0);
  assert.equal((await send("PUT", "{}")).status, 200);
  assert.equal(writes, 1);
  assert.equal(reads, 4);
  const denied = createBusinessDetailsHttpHandler({
    baseURL,
    service: {
      ...service,
      async readDetails() {
        throw new DirectoryAccessError(403, "ACCOUNT_SUSPENDED");
      },
    },
  });
  const result = await denied(
    new Request(`${baseURL}/api/business-details/mine/${id}`, {
      method: "PUT",
      headers: {
        origin: baseURL,
        "X-AhiBizz-Account-ID": "fixture-member",
        "Content-Type": "application/json",
      },
      body: "{",
    }),
  );
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { code: "ACCOUNT_SUSPENDED" });
  assert.equal(result.headers.get("cache-control"), "no-store");
  const get = new Request(`${baseURL}/api/business-details/mine/${id}`, {
    headers: { "sec-fetch-site": "same-origin", "X-AhiBizz-Account-ID": "fixture-member" },
  });
  assert.equal((await handler(get)).status, 200);
});
test("details client constrains endpoint, actor, credentials and validates returned facts", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, `/api/business-details/mine/${id}`);
      assert.equal(new Headers(options?.headers).get("X-AhiBizz-Account-ID"), "fixture-member");
      assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.mode, "same-origin");
      return Response.json({ business: { id, status: "draft", version: 1, details: week() } });
    };
    await businessDetailsRequest(id, "fixture-member");
    assert.equal(calls, 1);
    await assert.rejects(
      () => businessDetailsRequest("../../other", "fixture-member"),
      DirectoryRequestError,
    );
    await assert.rejects(() => businessDetailsRequest(id, ""), DirectoryRequestError);
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ code: "VERSION_CONFLICT" }, { status: 409 });
    await assert.rejects(
      () => businessDetailsRequest(id, "fixture-member"),
      (error: unknown) => error instanceof DirectoryRequestError && error.status === 409,
    );
    globalThis.fetch = async () =>
      Response.json({
        business: { id, status: "draft", version: 1, details: { ...week(), amenities: ["fake"] } },
      });
    await assert.rejects(() => businessDetailsRequest(id, "fixture-member"));
  } finally {
    globalThis.fetch = original;
  }
});
