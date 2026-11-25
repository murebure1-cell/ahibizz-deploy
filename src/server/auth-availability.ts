import { readAuthConfiguration } from "./auth/config";

export function authenticationAvailable(): boolean {
  try {
    return readAuthConfiguration() !== null;
  } catch {
    return false;
  }
}

/** The one public address sign-in works on, or null while authentication is not configured. */
export function configuredOrigin(): string | null {
  try {
    return readAuthConfiguration()?.baseURL ?? null;
  } catch {
    return null;
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
