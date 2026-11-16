import { accountReturnPath } from "./account-return";
import { adminReturnPath } from "./admin-navigation";

export type NavigationRole = "member" | "owner";

/** Presentation only; protected routes and APIs independently verify the signed session. */
export function readEligibleNavigationRole(value: unknown): NavigationRole | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const account = value as Record<string, unknown>;
  if (
    ["id", "role", "emailVerified", "approval"].some((key) => !Object.hasOwn(account, key)) ||
    typeof account.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(account.id) ||
    account.emailVerified !== true ||
    account.approval !== "approved" ||
    (account.role !== "member" && account.role !== "owner")
  )
    return null;
  return account.role;
}

/** A current eligible account can skip the sign-in form, using a closed destination. */
export function signedInReturnPath(account: unknown, destination: unknown): string | null {
  const role = readEligibleNavigationRole(account);
  if (!role) return null;
  const next = accountReturnPath(destination);
  return role === "member" && adminReturnPath(next) ? "/nalog" : next;
}
