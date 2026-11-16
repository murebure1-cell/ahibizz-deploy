import assert from "node:assert/strict";
import test from "node:test";
import type { PublicBookingConfiguration } from "../src/lib/booking";
import { createPublicBookingOffer } from "../src/lib/public-booking-offer";

const offer = (version: number, priceMinor = 4500): PublicBookingConfiguration => ({
  enabled: true,
  timezone: "Europe/Sarajevo",
  version,
  services: [{ id: "service-1", name: "Masaža", durationMinutes: 45, priceMinor }],
});
const quote = {
  serviceId: "service-1",
  startsAt: "2030-01-07T08:00:00.000Z",
  configurationVersion: 1,
};

test("a refreshed offer queues while the original command is unresolved and never changes its displayed snapshot", () => {
  const input = offer(1),
    state = createPublicBookingOffer(input),
    original = state.applied;
  const inputService = input.services[0];
  assert.ok(inputService);
  inputService.priceMinor = 9999;
  assert.equal(original.configuration?.services[0]?.priceMinor, 4500);
  assert.equal(state.receive(offer(2, 5500)), true);
  assert.equal(state.canDispatch(quote), false);
  assert.equal(state.apply(true), original);
  assert.equal(state.applied.configuration?.services[0]?.priceMinor, 4500);
  assert.equal(state.apply(false).configuration?.services[0]?.priceMinor, 5500);
});

test("disabled and unavailable offers cannot dispatch but do not discard an unresolved quote", () => {
  const state = createPublicBookingOffer(offer(1)),
    original = state.applied;
  state.receive({ ...offer(2), enabled: false, services: [] });
  assert.equal(state.apply(true), original);
  assert.equal(state.canDispatch(quote), false);
  state.receive(null);
  assert.equal(state.apply(true), original);
  const latest = state.apply(false);
  assert.equal(latest.available, false);
  assert.equal(latest.configuration?.version, 2);
  assert.equal(latest.configuration?.enabled, false);
});

test("equal objects preserve the current selection epoch and lower offers never regress a quote", () => {
  const state = createPublicBookingOffer(offer(3, 6500)),
    initial = state.latest;
  assert.equal(state.receive(offer(3, 6500)), false);
  assert.equal(state.latest, initial);
  assert.equal(state.receive(offer(1)), false);
  assert.equal(state.latest, initial);
  assert.equal(state.receive(null), true);
  assert.equal(state.receive(offer(1)), false);
  assert.equal(state.latest.available, false);
  assert.equal(state.receive(offer(3, 6500)), true);
  assert.equal(state.latest.available, true);
  assert.equal(state.latest.configuration?.version, 3);
});

test("a configuration read begun before newer props or an unavailable refresh cannot replace the latest offer", () => {
  const state = createPublicBookingOffer(offer(1)),
    readRevision = state.latest.revision;
  state.receive(offer(3, 6500));
  assert.equal(state.receiveRead(offer(2, 5500), readRevision), false);
  assert.equal(state.latest.configuration?.version, 3);
  const nextRead = state.latest.revision;
  state.receive(null);
  assert.equal(state.receiveRead(offer(4, 7500), nextRead), false);
  assert.equal(state.latest.available, false);
  assert.equal(state.latest.configuration?.version, 3);
});

test("an initially unavailable widget can adopt its first confirmed configuration", () => {
  const state = createPublicBookingOffer(null);
  assert.equal(state.latest.configuration, null);
  assert.equal(state.canDispatch(quote), false);
  state.receive(offer(1));
  assert.equal(state.apply(false).available, true);
  assert.equal(state.canDispatch(quote), true);
  assert.equal(state.canDispatch({ ...quote, serviceId: "removed" }), false);
});
