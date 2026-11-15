import type { SafeAccountProfile } from "../server/auth/accounts";

export type AdminAccountApproval = "pending" | "approved" | "suspended";
export type AdminAccountQuery = { approval: AdminAccountApproval; page: number; q: string };
export type AdminAccountPage = {
  accounts: SafeAccountProfile[];
  approval: AdminAccountApproval;
  page: number;
  hasMore: boolean;
  limit: 30;
};

function invalid(): never {
  throw new Error("invalid_admin_account_response");
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/\p{Cc}/u.test(value)
  );
}

/** Parse only documented account fields; never carry response extras into component state. */
export function readSafeAccountProfile(value: unknown): SafeAccountProfile {
  const row = record(value, [
    "id",
    "name",
    "email",
    "emailVerified",
    "role",
    "approval",
    "locale",
    "appearance",
  ]);
  if (
    typeof row.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) ||
    !text(row.name, 1000) ||
    !text(row.email, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(row.email) ||
    typeof row.emailVerified !== "boolean" ||
    (row.role !== "member" && row.role !== "owner") ||
    (row.approval !== "pending" && row.approval !== "approved" && row.approval !== "suspended") ||
    (row.locale !== "bs" &&
      row.locale !== "en" &&
      row.locale !== "de" &&
      row.locale !== "ar" &&
      row.locale !== "tr") ||
    (row.appearance !== "system" && row.appearance !== "light" && row.appearance !== "dark")
  )
    invalid();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    role: row.role,
    approval: row.approval,
    locale: row.locale,
    appearance: row.appearance,
  };
}

export function adminAccountQuery(
  approval: AdminAccountApproval,
  page: number,
  search = "",
): AdminAccountQuery {
  const q = search.trim();
  if (
    !["pending", "approved", "suspended"].includes(approval) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000 ||
    q.length > 80 ||
    /\p{Cc}/u.test(q)
  )
    throw new Error("invalid_admin_account_query");
  return { approval, page, q };
}

export function adminAccountPath(query: AdminAccountQuery): string {
  const value = adminAccountQuery(query.approval, query.page, query.q);
  const params = new URLSearchParams({ approval: value.approval, page: String(value.page) });
  if (value.q) params.set("q", value.q);
  return `/api/admin/accounts?${params}`;
}

export function readAdminAccountPage(value: unknown, query: AdminAccountQuery): AdminAccountPage {
  const row = record(value, ["accounts", "approval", "page", "hasMore", "limit"]);
  if (
    row.approval !== query.approval ||
    row.page !== query.page ||
    row.limit !== 30 ||
    typeof row.hasMore !== "boolean" ||
    !Array.isArray(row.accounts) ||
    row.accounts.length > 30
  )
    invalid();
  const accounts = row.accounts.map(readSafeAccountProfile);
  if (
    accounts.some((item) => item.approval !== query.approval) ||
    new Set(accounts.map((item) => item.id)).size !== accounts.length
  )
    invalid();
  return {
    accounts,
    approval: query.approval,
    page: query.page,
    hasMore: row.hasMore,
    limit: 30,
  };
}

export function readAdminAccountDecision(
  value: unknown,
  targetId: string,
  approval: "approved" | "suspended",
): SafeAccountProfile {
  const row = record(value, ["account"]);
  const result = readSafeAccountProfile(row.account);
  if (result.id !== targetId || result.role !== "member" || result.approval !== approval) invalid();
  return result;
}
