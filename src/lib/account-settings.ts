import type { SafeAccountProfile } from "../server/auth/accounts";
import { readSafeAccountProfile } from "./admin-accounts";
import { type Appearance, isAppearance } from "./appearance";

export class AccountSettingsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Account settings could not be confirmed.");
  }
}

/** Bind a mounted settings panel to its account, independently of later cookie changes. */
export function accountSettingsActorRequest(
  expectedAccountId: string,
  request: typeof accountSettingsRequest = accountSettingsRequest,
): typeof accountSettingsRequest {
  return (options = {}) => {
    if (typeof expectedAccountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      return Promise.reject(new AccountSettingsError(401, "ACCOUNT_IDENTITY_CHANGED"));
    const headers = new Headers(options.headers);
    headers.set("X-AhiBizz-Account-ID", expectedAccountId);
    return request({ ...options, headers });
  };
}

export function appearanceUpdate(appearance: Appearance, expectedAppearance: Appearance) {
  if (!isAppearance(appearance) || !isAppearance(expectedAppearance))
    throw new AccountSettingsError(400, "INVALID_PROFILE");
  return { appearance, expectedAppearance };
}

/** A settings acknowledgement must belong to the current eligible signed-in account. */
export function readAccountSettings(
  value: unknown,
  expectedId: string,
  expectedAppearance?: Appearance,
): SafeAccountProfile {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "account")
  )
    throw new AccountSettingsError(503, "INVALID_ACCOUNT_RESPONSE");
  let account: SafeAccountProfile;
  try {
    account = readSafeAccountProfile((value as { account: unknown }).account);
  } catch {
    throw new AccountSettingsError(503, "INVALID_ACCOUNT_RESPONSE");
  }
  if (account.id !== expectedId) throw new AccountSettingsError(401, "ACCOUNT_IDENTITY_CHANGED");
  if (account.approval === "suspended") throw new AccountSettingsError(403, "ACCOUNT_SUSPENDED");
  if (account.approval !== "approved")
    throw new AccountSettingsError(403, "ACCOUNT_PENDING_APPROVAL");
  if (!account.emailVerified) throw new AccountSettingsError(403, "EMAIL_NOT_VERIFIED");
  if (expectedAppearance !== undefined && account.appearance !== expectedAppearance)
    throw new AccountSettingsError(503, "INVALID_ACCOUNT_RESPONSE");
  return account;
}

export async function accountSettingsRequest(options: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(options.headers);
  if (options.method === "PATCH") headers.set("Content-Type", "application/json");
  const response = await fetch("/api/account", {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers,
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AccountSettingsError(response.ok ? 503 : response.status, "INVALID_ACCOUNT_RESPONSE");
  }
  if (!response.ok) {
    const code =
      value && typeof value === "object" && "code" in value && typeof value.code === "string"
        ? value.code
        : "ACCOUNT_UNAVAILABLE";
    throw new AccountSettingsError(response.status, code);
  }
  return value;
}

export function accountSettingsError(failure: unknown): string {
  if (failure instanceof AccountSettingsError) {
    if (failure.status === 401) return "Prijavi se ponovo za pristup postavkama.";
    if (failure.status === 403) return "Postavke trenutno nisu dostupne ovom nalogu.";
    if (failure.code === "APPEARANCE_CONFLICT")
      return "Postavke su izmijenjene. Osvježi ih prije spremanja.";
  }
  return "Postavke nisu potvrđene. Osvježi ih prije novog pokušaja.";
}
