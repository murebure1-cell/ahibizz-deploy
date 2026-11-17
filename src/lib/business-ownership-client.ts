import type {
  OwnershipCommand,
  OwnershipLookup,
  OwnershipPerson,
  OwnershipReceipt,
  OwnershipSnapshot,
} from "./business-ownership";
import { DirectoryRequestError } from "./directory-create-submission";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const account = /^[A-Za-z0-9_-]{1,128}$/;
const unavailable = (): never => {
  throw new DirectoryRequestError("OWNERSHIP_UNAVAILABLE", 503);
};
function person(value: unknown): OwnershipPerson {
  if (!value || typeof value !== "object") return unavailable();
  const item = value as OwnershipPerson;
  if (
    typeof item.id !== "string" ||
    !account.test(item.id) ||
    typeof item.name !== "string" ||
    !item.name.trim() ||
    item.name.length > 256 ||
    typeof item.email !== "string" ||
    item.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)
  )
    return unavailable();
  return { id: item.id, name: item.name, email: item.email };
}
function receipt(value: unknown, businessId: string): OwnershipReceipt | null {
  if (value == null) return null;
  if (!value || typeof value !== "object") return unavailable();
  const row = value as OwnershipReceipt;
  if (
    !uuid.test(row.requestId) ||
    row.businessId !== businessId ||
    typeof row.previousOwnerId !== "string" ||
    !account.test(row.previousOwnerId) ||
    typeof row.targetAccountId !== "string" ||
    !account.test(row.targetAccountId) ||
    !Number.isInteger(row.previousVersion) ||
    row.previousVersion < 1 ||
    row.resultVersion !== row.previousVersion + 1 ||
    row.resultVersion > 2147483647 ||
    typeof row.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(row.recordedAt))
  )
    return unavailable();
  return row;
}
export function readOwnershipSnapshot(value: unknown, businessId: string): OwnershipSnapshot {
  if (!value || typeof value !== "object") return unavailable();
  const row = value as OwnershipSnapshot;
  const currentOwner = person(row.currentOwner);
  if (
    row.business?.id !== businessId ||
    row.business.ownerId !== currentOwner.id ||
    typeof row.business.title !== "string" ||
    !row.business.title.trim() ||
    !["draft", "pending", "published", "archived"].includes(row.business.status) ||
    !Number.isInteger(row.business.version) ||
    row.business.version < 1 ||
    row.business.version > 2147483647
  )
    return unavailable();
  const record = receipt(row.receipt, businessId);
  if (
    record &&
    (record.resultVersion > row.business.version ||
      (record.resultVersion === row.business.version && record.targetAccountId !== currentOwner.id))
  )
    return unavailable();
  return { business: row.business, currentOwner, receipt: record };
}
export type BusinessOwnershipApi = {
  read(
    businessId: string,
    accountId: string,
    requestId?: string,
    signal?: AbortSignal,
  ): Promise<OwnershipSnapshot>;
  lookup(
    businessId: string,
    email: string,
    accountId: string,
    signal?: AbortSignal,
  ): Promise<OwnershipLookup>;
  assign(
    businessId: string,
    command: OwnershipCommand,
    accountId: string,
  ): Promise<OwnershipSnapshot>;
};
export function createBusinessOwnershipApi(request: typeof fetch = fetch): BusinessOwnershipApi {
  async function call(id: string, actor: string, tail: string, options: RequestInit = {}) {
    if (
      typeof id !== "string" ||
      !uuid.test(id) ||
      typeof actor !== "string" ||
      !account.test(actor)
    )
      throw new DirectoryRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
    const headers = new Headers(options.headers);
    headers.set("X-AhiBizz-Account-ID", actor);
    const response = await request(`/api/directory/ownership/${id}${tail}`, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data && typeof data === "object" && "code" in data ? data.code : null;
      throw new DirectoryRequestError(
        typeof code === "string" ? code : "OWNERSHIP_UNAVAILABLE",
        response.status,
      );
    }
    return data;
  }
  return {
    async read(id, actor, requestId, signal) {
      if (requestId !== undefined && !uuid.test(requestId))
        throw new DirectoryRequestError("INVALID_OWNERSHIP_INPUT", 400);
      return readOwnershipSnapshot(
        await call(id, actor, requestId ? `?requestId=${requestId}` : "", { signal }),
        id,
      );
    },
    async lookup(id, email, actor, signal) {
      const value = await call(id, actor, "/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        signal,
      });
      const row = readOwnershipSnapshot(value, id);
      const candidate = person((value as OwnershipLookup).candidate);
      if (candidate.email.toLocaleLowerCase("en") !== email.trim().toLocaleLowerCase("en"))
        return unavailable();
      return { ...row, candidate };
    },
    async assign(id, command, actor) {
      return readOwnershipSnapshot(
        await call(id, actor, "", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        }),
        id,
      );
    },
  };
}
export const businessOwnershipApi = createBusinessOwnershipApi();
