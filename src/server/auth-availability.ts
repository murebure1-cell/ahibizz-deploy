import { readAuthConfiguration } from "./auth/config";

export function authenticationAvailable(): boolean {
  try {
    return readAuthConfiguration() !== null;
  } catch {
    return false;
  }
}

/** True only when a valid Google client pair is configured on the server. */
export function googleSignInAvailable(): boolean {
  try {
    return readAuthConfiguration()?.google != null;
  } catch {
    return false;
  }
}
