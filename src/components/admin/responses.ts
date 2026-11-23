import type { SafeAccountProfile } from "../../server/auth/accounts";
import type { DirectoryCategory } from "../../server/directory/types";

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class AdminRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code = "",
  ) {
    super("Administrator request could not be completed.");
  }
}

export type AdminRequest = (path: string, init?: RequestInit) => Promise<Response>;
export const browserAdminRequest: AdminRequest = (path, init) => fetch(path, init);
export function adminActorRequest(
  expectedAccountId: string | undefined,
  request: AdminRequest = browserAdminRequest,
): AdminRequest {
  return (path, init = {}) => {
    if (!expectedAccountId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      return Promise.reject(new AdminRequestError(401, "ACCOUNT_IDENTITY_CHANGED"));
    const headers = new Headers(init.headers);
    headers.set("X-AhiBizz-Account-ID", expectedAccountId);
    return request(path, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
    });
  };
}
export function adminAccessDenied(error: unknown): boolean {
  return error instanceof AdminRequestError && [401, 403].includes(error.status);
}

export async function responseData(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new AdminRequestError(
      response.status,
      record(data) && typeof data.code === "string" ? data.code : "",
    );
  if (!record(data)) throw new AdminRequestError(502);
  return data;
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof AdminRequestError))
    return "Odgovor nije stigao. Osvježi podatke prije ponovnog slanja.";
  if (error.status === 401 || error.code === "ACCOUNT_SUSPENDED")
    return "Prijava više nije dostupna. Prijavi se ponovo.";
  if (error.status === 403) return "Nemaš pristup ovoj radnji.";
  if (error.code === "CATEGORY_CONFLICT")
    return "Kategorija već postoji ili je izmijenjena. Osvježi listu i provjeri unos.";
  if (error.status === 409)
    return "Podaci su u međuvremenu izmijenjeni. Osvježi listu prije nove odluke.";
  if (error.status === 400) return "Provjeri unesene podatke.";
  if (error.status === 502) return "Podaci nisu učitani. Pokušaj ponovo.";
  return "Podaci trenutno nisu dostupni. Pokušaj ponovo.";
}

export function accountProfile(value: unknown): value is SafeAccountProfile {
  return (
    record(value) &&
    typeof value.id === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.email === "string" &&
    value.email.length > 0 &&
    typeof value.emailVerified === "boolean" &&
    ["member", "owner"].includes(String(value.role)) &&
    ["pending", "approved", "suspended"].includes(String(value.approval)) &&
    ["bs", "en", "de", "ar", "tr"].includes(String(value.locale)) &&
    ["system", "light", "dark"].includes(String(value.appearance))
  );
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function category(value: unknown): value is DirectoryCategory {
  return (
    record(value) &&
    typeof value.id === "string" &&
    uuid.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 80 &&
    typeof value.slug === "string" &&
    (value.vehicleRental === undefined || typeof value.vehicleRental === "boolean") &&
    (value.accommodation === undefined || typeof value.accommodation === "boolean") &&
    value.slug.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) &&
    (value.parentId === null || (typeof value.parentId === "string" && uuid.test(value.parentId)))
  );
}

export function categoryList(data: Record<string, unknown>): DirectoryCategory[] {
  if (!Array.isArray(data.categories) || !data.categories.every(category))
    throw new AdminRequestError(502);
  const rows = data.categories;
  const byId = new Map(rows.map((item) => [item.id, item]));
  if (byId.size !== rows.length || new Set(rows.map((item) => item.slug)).size !== rows.length)
    throw new AdminRequestError(502);
  for (const item of rows) {
    if (item.parentId !== null && byId.get(item.parentId)?.parentId !== null)
      throw new AdminRequestError(502);
  }
  return rows;
}

/** Deterministic display-name identifier, not a token or security hash. */
export function categorySlug(name: string, parentSlug?: string): string {
  const normalized = name.trim().normalize("NFKD").toLocaleLowerCase("bs");
  let hash = 2166136261;
  for (const character of `${parentSlug ?? ""}/${normalized}`)
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619);
  const suffix = (hash >>> 0).toString(16).padStart(8, "0");
  const latin = normalized
    .replace(/đ/g, "dj")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = latin || `kategorija-${suffix}`;
  const value = parentSlug ? `${parentSlug}-${stem}` : stem;
  return value.length <= 80 ? value : `${value.slice(0, 71).replace(/-+$/g, "")}-${suffix}`;
}
