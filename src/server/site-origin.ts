import { authOrigin } from "./auth/config";

/** The public address of the app (BETTER_AUTH_URL), or null when it is not configured. */
export function siteOrigin(): string | null {
  try {
    const value = process.env.BETTER_AUTH_URL;
    return value ? authOrigin(value, process.env.NODE_ENV === "production") : null;
  } catch {
    return null;
  }
}
