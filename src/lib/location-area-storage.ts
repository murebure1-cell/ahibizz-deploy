import type { LocationPoint } from "./business-location";
import { areaRememberMs, coarseArea } from "./device-location";

/** Device-only storage of the approximate (~1 km) area used for an instant nearby list. */
const areaKey = "ahibizz.location.area.v1";

export function readRememberedArea(): LocationPoint | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(areaKey) ?? "null");
    if (
      !value ||
      !Number.isFinite(value.latitude) ||
      !Number.isFinite(value.longitude) ||
      !Number.isFinite(value.savedAt) ||
      Math.abs(value.latitude) > 90 ||
      Math.abs(value.longitude) > 180 ||
      Date.now() - value.savedAt > areaRememberMs ||
      value.savedAt > Date.now() + 60_000
    )
      return null;
    // Re-round on read so an edited value can never be more precise than the area.
    return coarseArea({ latitude: value.latitude, longitude: value.longitude });
  } catch {
    return null;
  }
}

export function saveRememberedArea(area: LocationPoint) {
  try {
    const rounded = coarseArea(area);
    const stored = JSON.parse(window.localStorage.getItem(areaKey) ?? "null");
    // Rewrite only when the ~1 km area changes or the saved copy is an hour old.
    if (
      stored?.latitude === rounded.latitude &&
      stored?.longitude === rounded.longitude &&
      Date.now() - Number(stored?.savedAt ?? 0) < 3_600_000
    )
      return;
    window.localStorage.setItem(
      areaKey,
      JSON.stringify({
        latitude: rounded.latitude,
        longitude: rounded.longitude,
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* Optional storage may be unavailable. */
  }
}

/** Called when location is switched off and on sign-out, so a shared device keeps no area. */
export function forgetRememberedArea() {
  try {
    window.localStorage.removeItem(areaKey);
  } catch {
    /* Never block sign-out or a permission change. */
  }
}
