import assert from "node:assert/strict";
import test from "node:test";
import { BookingAccessError, manualInput } from "../src/server/booking/validation";

const serviceId = "00100000-0000-4000-8000-000000000003";
const startsAt = "2030-01-07T08:00:00Z";

test("historical manual commands retain the exact normalized body used by old receipts", () => {
  const body = manualInput({ kind: "manual", serviceId, startsAt });
  assert.equal(Object.hasOwn(body, "configurationVersion"), false);
  assert.equal(
    JSON.stringify(body),
    JSON.stringify({
      kind: "manual",
      serviceId,
      startsAt: "2030-01-07T08:00:00.000Z",
      endsAt: null,
      clientName: null,
      clientPhone: null,
    }),
  );
});

test("new manual and busy-block commands carry a bounded version, including empty settings version zero", () => {
  assert.equal(
    manualInput({ kind: "manual", serviceId, startsAt, configurationVersion: 3 })
      .configurationVersion,
    3,
  );
  assert.equal(
    manualInput({
      kind: "block",
      startsAt,
      endsAt: "2030-01-07T09:00:00Z",
      configurationVersion: 0,
    }).configurationVersion,
    0,
  );
  for (const configurationVersion of [-1, null, "3", 1.5, 2147483647]) {
    assert.throws(
      () => manualInput({ kind: "manual", serviceId, startsAt, configurationVersion }),
      (error) => error instanceof BookingAccessError && error.code === "INVALID_BOOKING_INPUT",
    );
  }
});
