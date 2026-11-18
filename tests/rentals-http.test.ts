import assert from "node:assert/strict";
import test from "node:test";
import { AccountAccessError } from "../src/server/auth/accounts";
import type { RentalService } from "../src/server/rentals/service";
import { createRentalHttpHandler } from "../src/server/rentals-http";

const origin = "https://ahibizz.example";
const url = (path: string) => new URL(`/api/rentals/${path}`, origin);
const unexpected = (): never => {
  throw new Error("Unexpected service method");
};
const unused: RentalService = {
  publicCatalog: unexpected,
  ownerCatalog: unexpected,
  saveVehicle: unexpected,
  archiveVehicle: unexpected,
  calendar: unexpected,
  available: unexpected,
  ownerCalendar: unexpected,
  request: unexpected,
  block: unexpected,
  myBookings: unexpected,
  decide: unexpected,
};

test("a calendar sends only busy intervals to a visitor and private entries to the owner", async () => {
  const interval = { startsAt: "2030-01-01T08:00:00Z", endsAt: "2030-01-01T10:00:00Z" };
  const actor = "fixture-owner";
  const handle = createRentalHttpHandler(
    {
      ...unused,
      async calendar(businessId, vehicleId, from, to) {
        assert.deepEqual(
          [businessId, vehicleId, from, to],
          ["business", "car", interval.startsAt, interval.endsAt],
        );
        return [interval];
      },
      async ownerCalendar(headers) {
        if (headers.get("X-AhiBizz-Account-ID") !== actor)
          throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
        return [
          {
            ...interval,
            id: "entry",
            vehicleId: "car",
            businessId: "business",
            businessTitle: "Rental",
            vehicleName: "Test car",
            timezone: "Europe/Sarajevo",
            kind: "customer",
            status: "requested",
            version: 1,
            totalMinor: 1000,
            customerName: "Fixture",
          },
        ];
      },
    },
    origin,
  );
  const range = new URLSearchParams({ from: interval.startsAt, to: interval.endsAt });
  const read = (area: string, headers?: HeadersInit) =>
    handle(new Request(url(`${area}/business/car/calendar?${range}`), { headers }));
  const publicResponse = await read("public");
  assert.deepEqual(await publicResponse.json(), { entries: [interval] });
  assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  assert.equal((await read("owner")).status, 401);
  assert.equal(
    (await (await read("owner", { "X-AhiBizz-Account-ID": actor })).json()).entries[0].customerName,
    "Fixture",
  );
  assert.equal(
    (await handle(new Request(url("public/business/car/calendar?from=a&from=b")))).status,
    400,
  );
});

test("rental mutations require a same-origin JSON request, and keep service conflict outcomes", async () => {
  let calls = 0;
  const handle = createRentalHttpHandler(
    {
      ...unused,
      async request(headers, businessId, vehicleId, body) {
        calls++;
        assert.deepEqual(
          [businessId, vehicleId, body, headers.get("X-AhiBizz-Account-ID")],
          ["business", "car", { expectedVehicleVersion: 1 }, "customer"],
        );
        throw new AccountAccessError(409, "RENTAL_OVERLAP");
      },
    },
    origin,
  );
  const send = (site: string, type: string, body: string) =>
    handle(
      new Request(url("request/business/car"), {
        method: "POST",
        headers: { "Content-Type": type, origin: site, "X-AhiBizz-Account-ID": "customer" },
        body,
      }),
    );
  assert.equal((await send("https://other.example", "application/json", "{}")).status, 403);
  assert.equal((await send(origin, "text/plain", "{}")).status, 415);
  assert.equal((await send(origin, "application/json", '{"x":1,"x":2}')).status, 400);
  assert.equal((await send(origin, "application/json", "x".repeat(4097))).status, 413);
  assert.equal(calls, 0);
  const conflict = await send(origin, "application/json", '{"expectedVehicleVersion":1}');
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { code: "RENTAL_OVERLAP" });
  assert.equal(calls, 1);
});
