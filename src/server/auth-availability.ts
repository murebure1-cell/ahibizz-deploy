import { readAuthConfiguration } from "./auth/config";

export function authenticationAvailable(): boolean {
  try {
    return readAuthConfiguration() !== null;
  } catch {
    return false;
  }
}
