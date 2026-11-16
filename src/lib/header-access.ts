import { type NavigationRole, readEligibleNavigationRole } from "./session-navigation";

export type HeaderAccess = NavigationRole | "unknown" | "guest";
export type HeaderAccessRequest = (options: { signal: AbortSignal }) => Promise<HeaderAccess>;

export function readHeaderAccess(value: unknown): HeaderAccess {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "account")
  )
    return "unknown";
  return readEligibleNavigationRole((value as Record<string, unknown>).account) ?? "unknown";
}

export const headerAccessRequest: HeaderAccessRequest = async ({ signal }) => {
  const response = await fetch("/api/account", {
    method: "GET",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (response.status === 401) return "guest";
  if (!response.ok) return "unknown";
  return readHeaderAccess(await response.json().catch(() => null));
};
