import { initialLocationPoint, type LocationPoint } from "./business-location";

export type LocationPermission = "unknown" | "prompt" | "granted" | "denied";
export type DeviceLocationState = {
  point: LocationPoint | null;
  status: "idle" | "locating" | "ready" | "denied" | "unavailable";
  permission: LocationPermission;
};
export const initialDeviceLocation: DeviceLocationState = {
  point: null,
  status: "idle",
  permission: "unknown",
};
export const locationRefreshMs = 30_000;
export const locationStaleMs = 300_000;
/** Later fixes must be this recent to move an existing origin. */
export const freshFixMs = 90_000;
/**
 * The first fix may reuse the position the device already holds, so nearby results appear at
 * once instead of waiting for a new satellite or network fix; the watch then refines it.
 */
export const cachedFixMs = 600_000;
/** How long the device keeps the approximate area (about 1 km) for an instant next visit. */
export const areaRememberMs = 86_400_000;

/** About 1 km: enough to list nearby businesses, too coarse to reveal an address. */
export function coarseArea(point: LocationPoint): LocationPoint {
  return {
    latitude: Math.round(point.latitude * 100) / 100,
    longitude: Math.round(point.longitude * 100) / 100,
    accuracy: 1100,
  };
}

export function distanceMetres(a: LocationPoint, b: LocationPoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Nearby queries need an approximate origin, not a persistent precise location history. */
export function nearbyQueryPoint(point: LocationPoint): LocationPoint {
  return {
    latitude: Math.round(point.latitude * 1000) / 1000,
    longitude: Math.round(point.longitude * 1000) / 1000,
  };
}

export type LocationEnvironment = {
  gps?: Pick<Geolocation, "getCurrentPosition" | "watchPosition" | "clearWatch">;
  permission?: () => Promise<PermissionStatus>;
  visible: () => boolean;
  observeVisibility: (listener: () => void) => () => void;
  now: () => number;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (id: number) => void;
  remembered?: () => boolean;
  remember?: (allowed: boolean) => void;
  /** A previously stored approximate area, already checked for age; never an exact point. */
  rememberedArea?: () => LocationPoint | null;
  rememberArea?: (area: LocationPoint) => void;
  forgetArea?: () => void;
};

/** Foreground-only GPS lifecycle. Exact points live only in this provider's memory. */
export function createDeviceLocationController(
  environment: LocationEnvironment,
  changed: (state: DeviceLocationState) => void,
) {
  let state = { ...initialDeviceLocation };
  let running = false,
    active = false,
    requesting = false,
    userRequested = false,
    permissionEpoch = 0,
    positionEpoch = 0;
  let watch: number | undefined,
    pendingTimer: number | undefined,
    staleTimer: number | undefined,
    removeVisibility: (() => void) | undefined,
    removePermission: (() => void) | undefined;
  let publishedAt = 0,
    lastFixAt = 0,
    lastPositionAt = 0,
    pending: LocationPoint | null = null,
    provisional = false;
  const options: PositionOptions = {
    enableHighAccuracy: false,
    maximumAge: cachedFixMs,
    timeout: 15_000,
  };

  function update(next: Partial<DeviceLocationState>) {
    state = { ...state, ...next };
    if (running) changed(state);
  }
  function clearTimer(kind: "pending" | "stale") {
    const id = kind === "pending" ? pendingTimer : staleTimer;
    if (id !== undefined) environment.cancel(id);
    if (kind === "pending") pendingTimer = undefined;
    else staleTimer = undefined;
  }
  function stopPosition() {
    positionEpoch++;
    requesting = false;
    if (watch !== undefined) environment.gps?.clearWatch(watch);
    watch = undefined;
    pending = null;
    clearTimer("pending");
  }
  function expire() {
    clearTimer("stale");
    if (!state.point) return;
    const remaining = locationStaleMs - (environment.now() - lastFixAt);
    if (remaining > 0) staleTimer = environment.schedule(expire, remaining);
    else {
      update({
        point: null,
        status:
          state.permission === "denied"
            ? "denied"
            : active && environment.visible()
              ? "locating"
              : "idle",
      });
      if (active && environment.visible()) {
        stopPosition();
        locate();
      }
    }
  }
  function publish(point: LocationPoint) {
    publishedAt = environment.now();
    pending = null;
    clearTimer("pending");
    update({ point, status: "ready", permission: "granted" });
  }
  function success(position: GeolocationPosition, epoch: number) {
    if (!running || epoch !== positionEpoch || !environment.visible()) return;
    requesting = false;
    const point = initialLocationPoint(
      position.coords.latitude,
      position.coords.longitude,
      position.coords.accuracy,
    );
    const now = environment.now();
    const age = now - position.timestamp;
    if (
      !point ||
      (point.accuracy ?? 0) > 5000 ||
      !Number.isFinite(position.timestamp) ||
      position.timestamp < lastPositionAt ||
      age > (state.point && !provisional ? freshFixMs : cachedFixMs) ||
      position.timestamp - now > 5000
    ) {
      if (!state.point) update({ status: "unavailable" });
      return;
    }
    permissionEpoch++;
    userRequested = true;
    environment.remember?.(true);
    lastPositionAt = position.timestamp;
    // A reused device fix counts as at most `freshFixMs` old, so it stays usable while the watch refines it.
    lastFixAt = Math.min(now, Math.max(position.timestamp, now - freshFixMs));
    const cached = age > freshFixMs;
    if (!cached) environment.rememberArea?.(coarseArea(point));
    expire();
    // A remembered area or an old device fix is only a placeholder: any real fix replaces it at once.
    if (!state.point || provisional) {
      provisional = cached;
      publish(point);
      expire();
      return;
    }
    if (state.permission !== "granted" || state.status !== "ready")
      update({ permission: "granted", status: "ready" });
    if (distanceMetres(state.point, point) < Math.max(150, Math.min(point.accuracy ?? 0, 500))) {
      pending = null;
      clearTimer("pending");
      return;
    }
    pending = point;
    const remaining = locationRefreshMs - (now - publishedAt);
    if (!active || remaining <= 0) publish(point);
    else if (pendingTimer === undefined)
      pendingTimer = environment.schedule(() => {
        pendingTimer = undefined;
        if (running && active && environment.visible() && pending) publish(pending);
      }, remaining);
  }
  function denied() {
    userRequested = false;
    environment.remember?.(false);
    environment.forgetArea?.();
    stopPosition();
    clearTimer("stale");
    update({ point: null, permission: "denied", status: "denied" });
  }
  function failure(error: GeolocationPositionError, epoch: number) {
    if (!running || epoch !== positionEpoch) return;
    requesting = false;
    if (error.code === 1) denied();
    else if (!state.point) update({ status: "unavailable" });
  }
  function locate(explicit = false) {
    if (!running || !environment.visible() || watch !== undefined) return;
    if (!environment.gps) {
      update({ status: "unavailable" });
      return;
    }
    if (state.permission === "denied") return;
    if (!explicit && state.permission !== "granted" && !userRequested) return;
    if (requesting) return;
    // Only the first lookup of a visit uses the remembered area; an expired real fix re-acquires.
    if (!state.point && lastFixAt === 0) {
      const area = environment.rememberedArea?.();
      if (area) {
        // Show nearby results for the remembered area at once while the device finds the real fix.
        provisional = true;
        lastFixAt = environment.now() - freshFixMs;
        publish(area);
        expire();
      }
    }
    if (!state.point) update({ status: "locating" });
    const epoch = ++positionEpoch;
    requesting = true;
    try {
      if (active) {
        // Watches often wait for a new fix; a one-shot request may answer at once from the
        // position the device already holds (maximumAge), so ask both while only a placeholder exists.
        if (!state.point || provisional)
          environment.gps.getCurrentPosition(
            (position) => success(position, epoch),
            () => {},
            options,
          );
        const id = environment.gps.watchPosition(
          (position) => success(position, epoch),
          (error) => failure(error, epoch),
          options,
        );
        if (running && epoch === positionEpoch && environment.visible()) watch = id;
        else environment.gps.clearWatch(id);
      } else
        environment.gps.getCurrentPosition(
          (position) => success(position, epoch),
          (error) => failure(error, epoch),
          options,
        );
    } catch {
      requesting = false;
      if (!state.point) update({ status: "unavailable" });
    }
  }
  async function refreshPermission() {
    if (!running) return;
    if (!environment.permission) {
      if (state.permission !== "denied" && environment.remembered?.()) userRequested = true;
      if (active && environment.visible()) locate();
      return;
    }
    const epoch = ++permissionEpoch;
    try {
      const permission = await environment.permission();
      if (!running || epoch !== permissionEpoch) return;
      removePermission?.();
      const apply = () => {
        if (!running) return;
        if (permission.state === "denied") denied();
        else {
          if (permission.state === "prompt") {
            environment.remember?.(false);
            environment.forgetArea?.();
            if (state.point || state.permission === "granted") {
              userRequested = false;
              stopPosition();
              clearTimer("stale");
              update({ point: null, permission: "prompt", status: "idle" });
            }
          }
          update({ permission: permission.state });
          if (active && environment.visible() && permission.state === "granted") locate();
        }
      };
      permission.addEventListener("change", apply);
      removePermission = () => permission.removeEventListener("change", apply);
      apply();
    } catch {
      // Some browsers expose Permissions but do not implement its geolocation query.
      if (running && epoch === permissionEpoch) {
        if (state.permission !== "denied" && environment.remembered?.()) userRequested = true;
        if (active) locate();
      }
    }
  }
  function visibilityChanged() {
    if (!environment.visible()) stopPosition();
    else {
      expire();
      if (active) locate();
      void refreshPermission();
    }
  }
  return {
    start() {
      if (running) return;
      running = true;
      removeVisibility = environment.observeVisibility(visibilityChanged);
      if (!environment.gps) update({ status: "unavailable" });
      else void refreshPermission();
    },
    stop() {
      running = false;
      permissionEpoch++;
      stopPosition();
      clearTimer("stale");
      removePermission?.();
      removeVisibility?.();
    },
    setActive(value: boolean) {
      active = value;
      if (!active) stopPosition();
      else {
        expire();
        locate();
        void refreshPermission();
      }
    },
    requestLocation() {
      if (!running || !environment.visible()) return;
      if (requesting) return;
      userRequested = true;
      if (state.permission === "denied") {
        void refreshPermission();
        return;
      }
      stopPosition();
      locate(true);
    },
  };
}
