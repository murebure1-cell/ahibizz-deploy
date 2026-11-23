import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedFixMs,
  createDeviceLocationController,
  type DeviceLocationState,
  freshFixMs,
  type LocationEnvironment,
  locationRefreshMs,
  locationStaleMs,
  nearbyQueryPoint,
} from "../src/lib/device-location";

function fixture(initial: PermissionState | null = "prompt") {
  let now = 2_000_000_000_000,
    visible = true,
    nextId = 0,
    queryCount = 0,
    remembered = false;
  let visibility: (() => void) | undefined;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const watches = new Map<
    number,
    { success: PositionCallback; failure?: PositionErrorCallback | null }
  >();
  const cleared: number[] = [];
  const oneShots: { success: PositionCallback; failure?: PositionErrorCallback | null }[] = [];
  const eventTarget = new EventTarget();
  let permissionState = initial ?? "prompt";
  const permission = Object.defineProperty(
    Object.assign(eventTarget, { name: "geolocation", onchange: null }),
    "state",
    { get: () => permissionState },
  ) as unknown as PermissionStatus;
  const states: DeviceLocationState[] = [];
  const environment: LocationEnvironment = {
    gps: {
      watchPosition(success, failure) {
        const id = ++nextId;
        watches.set(id, { success, failure });
        return id;
      },
      clearWatch(id) {
        cleared.push(id);
        watches.delete(id);
      },
      getCurrentPosition(success, failure) {
        oneShots.push({ success, failure });
      },
    },
    permission:
      initial === null
        ? undefined
        : async () => {
            queryCount++;
            return permission;
          },
    visible: () => visible,
    observeVisibility(listener) {
      visibility = listener;
      return () => {
        visibility = undefined;
      };
    },
    now: () => now,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    remembered: () => remembered,
    remember: (allowed) => {
      remembered = allowed;
    },
  };
  const controller = createDeviceLocationController(environment, (state) => states.push(state));
  const position = (latitude: number, longitude: number, accuracy = 20, timestamp = now) =>
    ({ coords: { latitude, longitude, accuracy }, timestamp }) as GeolocationPosition;
  return {
    environment,
    controller,
    watches,
    cleared,
    oneShots,
    states,
    position,
    state: () => states.at(-1),
    get queryCount() {
      return queryCount;
    },
    get remembered() {
      return remembered;
    },
    setRemembered(value: boolean) {
      remembered = value;
    },
    permission(value: PermissionState) {
      permissionState = value;
      eventTarget.dispatchEvent(new Event("change"));
    },
    visible(value: boolean) {
      visible = value;
      visibility?.();
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
    },
    emit(latitude: number, longitude: number) {
      for (const watcher of watches.values()) watcher.success(position(latitude, longitude));
    },
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("first visit never prompts; explicit permission request starts one foreground watch and accepts zero coordinates", async () => {
  const f = fixture();
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  assert.equal(f.watches.size, 0);
  assert.equal(f.oneShots.length, 0);
  assert.equal(f.state()?.permission, "prompt");
  f.controller.requestLocation();
  assert.equal(f.watches.size, 1);
  f.emit(0, 0);
  assert.deepEqual(f.state()?.point, { latitude: 0, longitude: 0, accuracy: 20 });
  assert.equal(f.state()?.status, "ready");
  f.controller.stop();
  assert.equal(f.watches.size, 0);
});

test("already granted permission automatically follows movement, ignores jitter and publishes the latest trailing fix", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  assert.equal(f.watches.size, 1);
  f.emit(44.5, 18.6);
  const first = f.state()?.point;
  f.emit(44.50001, 18.60001);
  assert.equal(f.state()?.point, first);
  f.emit(44.51, 18.61);
  assert.equal(f.state()?.point, first);
  f.emit(44.52, 18.62);
  f.advance(locationRefreshMs - 1);
  assert.equal(f.state()?.point, first);
  f.advance(1);
  assert.equal(f.state()?.point?.latitude, 44.52);
  assert.equal(f.state()?.point?.longitude, 18.62);
  f.controller.stop();
});

test("returning near the current origin cancels an obsolete queued movement", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  f.emit(44.5, 18.6);
  const first = f.state()?.point;
  f.emit(44.52, 18.62);
  f.emit(44.50001, 18.60001);
  f.advance(locationRefreshMs);
  assert.equal(f.state()?.point, first);
  f.controller.stop();
});

test("a stationary foreground point gets one fresh acquisition at expiry, without a retry timer storm", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  f.emit(44.5, 18.6);
  const old = [...f.watches.keys()][0];
  f.advance(locationStaleMs);
  assert.equal(f.state()?.point, null);
  assert.equal(f.state()?.status, "locating");
  assert.equal(f.watches.size, 1);
  assert.ok(f.cleared.includes(old as number));
  const replacement = [...f.watches.keys()][0];
  f.advance(locationStaleMs);
  assert.equal([...f.watches.keys()][0], replacement);
  f.emit(44.5, 18.6);
  assert.equal(f.state()?.status, "ready");
  f.controller.stop();
});

test("delayed older fixes cannot replace a newer origin or extend its freshness", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  f.emit(44.5, 18.6);
  const first = f.state()?.point,
    watch = [...f.watches.values()][0];
  assert.ok(watch);
  watch.success(f.position(45, 19, 20, f.environment.now() - 1000));
  f.advance(locationRefreshMs);
  assert.equal(f.state()?.point, first);
  f.controller.stop();
});

test("hidden pages clear watches, invalidate queued fixes, expire the cached point and resume on return", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  const old = [...f.watches.values()][0];
  assert.ok(old);
  f.emit(44.5, 18.6);
  f.visible(false);
  assert.equal(f.watches.size, 0);
  old.success(f.position(50, 20));
  assert.equal(f.state()?.point?.latitude, 44.5);
  f.advance(locationStaleMs);
  assert.equal(f.state()?.point, null);
  f.visible(true);
  await flush();
  assert.equal(f.watches.size, 1);
  f.emit(50, 20);
  assert.equal(f.state()?.point?.latitude, 50);
  f.controller.setActive(false);
  assert.equal(f.watches.size, 0);
  f.controller.stop();
});

test("revocation immediately clears private location and never repeatedly prompts denied visitors", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  f.emit(44, 18);
  assert.equal(f.remembered, true);
  f.permission("denied");
  assert.equal(f.state()?.point, null);
  assert.equal(f.state()?.status, "denied");
  assert.equal(f.watches.size, 0);
  assert.equal(f.remembered, false);
  f.visible(false);
  f.visible(true);
  f.controller.requestLocation();
  await flush();
  assert.equal(f.watches.size, 0);
  assert.equal(f.oneShots.length, 0);
  f.permission("granted");
  assert.equal(f.watches.size, 1);
  f.controller.stop();
});

test("browsers without Permissions API still accept explicit one-shot consent and later watch automatically", async () => {
  const f = fixture(null);
  f.controller.start();
  await flush();
  assert.equal(f.oneShots.length, 0);
  f.controller.requestLocation();
  assert.equal(f.oneShots.length, 1);
  f.controller.requestLocation();
  assert.equal(f.oneShots.length, 1);
  f.oneShots[0]?.success(f.position(44.5, 18.6));
  assert.equal(f.state()?.status, "ready");
  f.controller.setActive(true);
  assert.equal(f.watches.size, 1);
  f.controller.stop();
});

test("stale, future, inaccurate and nonfinite fixes never become a real nearby origin", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  const watcher = [...f.watches.values()][0];
  assert.ok(watcher);
  watcher.success(f.position(44, 18, 20, f.environment.now() - cachedFixMs - 1));
  watcher.success(f.position(44, 18, 20, f.environment.now() + 5001));
  watcher.success(f.position(44, 18, 50_000));
  watcher.success(f.position(Number.NaN, 18));
  assert.equal(f.state()?.point, null);
  assert.equal(f.state()?.status, "unavailable");
  f.emit(44, 18);
  assert.equal(f.state()?.status, "ready");
  f.controller.stop();
});

test("the device's recent cached fix shows nearby results at once and the first fresh fix replaces it immediately", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  const watcher = [...f.watches.values()][0];
  assert.ok(watcher);
  // A five-minute-old position the phone already holds is accepted as the first origin.
  watcher.success(f.position(44.5, 18.6, 300, f.environment.now() - 300_000));
  assert.equal(f.state()?.status, "ready");
  assert.equal(f.state()?.point?.latitude, 44.5);
  // Once an origin exists, an older-than-fresh fix cannot move it.
  watcher.success(f.position(45, 19, 20, f.environment.now() - freshFixMs - 1));
  assert.equal(f.state()?.point?.latitude, 44.5);
  // The first fresh fix corrects the cached origin without the usual 30-second wait.
  watcher.success(f.position(44.53, 18.64));
  assert.equal(f.state()?.point?.latitude, 44.53);
  // After that, ordinary movement is throttled again.
  watcher.success(f.position(44.56, 18.68));
  assert.equal(f.state()?.point?.latitude, 44.53);
  // The reused fix is not treated as already stale, so the origin is not dropped at once.
  f.advance(locationStaleMs - freshFixMs - 1);
  assert.ok(f.state()?.point);
  f.controller.stop();
});

test("late permission resolution and late position callbacks cannot restart a stopped provider", async () => {
  const f = fixture("granted");
  f.controller.start();
  f.controller.setActive(true);
  f.controller.stop();
  await flush();
  assert.equal(f.watches.size, 0);
  assert.equal(f.states.length, 0);
});

test("nearby transport rounds the origin to about100 metres without changing the in-memory fix", () => {
  const point = { latitude: 44.538416, longitude: 18.667136, accuracy: 15 };
  assert.deepEqual(nearbyQueryPoint(point), { latitude: 44.538, longitude: 18.667 });
  assert.equal(point.latitude, 44.538416);
});

test("reopened browsers without Permissions API reuse only the successful consent marker, never saved coordinates", async () => {
  const f = fixture(null);
  f.setRemembered(true);
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  assert.equal(f.watches.size, 1);
  assert.equal(f.state()?.point, null);
  f.emit(44.5, 18.6);
  assert.equal(f.state()?.point?.latitude, 44.5);
  f.controller.stop();
});

test("supported prompt permission does not trust a stale opt-in marker and never starts a new prompt", async () => {
  const f = fixture("prompt");
  f.setRemembered(true);
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  assert.equal(f.watches.size, 0);
  assert.equal(f.oneShots.length, 0);
  assert.equal(f.remembered, false);
  f.controller.stop();
});

test("a rejected browser permission query can still resume a previously allowed foreground session", async () => {
  const f = fixture("granted");
  f.setRemembered(true);
  f.environment.permission = async () => {
    throw new Error("unsupported");
  };
  f.controller.start();
  f.controller.setActive(true);
  await flush();
  assert.equal(f.watches.size, 1);
  f.controller.stop();
});
