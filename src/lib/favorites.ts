import type { PublicDirectoryBusiness } from "../server/directory/types";

export type FavoriteState = { businessId: string; saved: boolean; version: number };
export type FavoriteStates = { accountId: string; items: FavoriteState[] };
export type FavoriteCommand = { saved: boolean; expectedVersion: number; idempotencyKey: string };
export type FavoritePage = {
  accountId: string;
  items: PublicDirectoryBusiness[];
  page: number;
  hasMore: boolean;
};
export type FavoritesApi = {
  states(ids: string[], accountId?: string, signal?: AbortSignal): Promise<FavoriteStates>;
  set(id: string, command: FavoriteCommand, accountId: string): Promise<FavoriteStates>;
  list(page: number, accountId: string, signal?: AbortSignal): Promise<FavoritePage>;
};
export class FavoritesClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
export function favoriteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  );
}
export function readFavoriteStates(value: unknown): FavoriteStates {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_favorites_response");
  const v = value as FavoriteStates;
  if (
    typeof v.accountId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(v.accountId) ||
    !Array.isArray(v.items) ||
    v.items.length > 50
  )
    throw new Error("invalid_favorites_response");
  const seen = new Set();
  for (const item of v.items) {
    if (
      !item ||
      !favoriteId(item.businessId) ||
      seen.has(item.businessId) ||
      typeof item.saved !== "boolean" ||
      !Number.isInteger(item.version) ||
      item.version < 0 ||
      item.version > 2147483647 ||
      (item.version === 0 && item.saved)
    )
      throw new Error("invalid_favorites_response");
    seen.add(item.businessId);
  }
  return {
    accountId: v.accountId,
    items: v.items.map((item) => ({
      businessId: item.businessId,
      saved: item.saved,
      version: item.version,
    })),
  };
}
export function createFavoritesApi(request: typeof fetch = fetch): FavoritesApi {
  async function json(path: string, init: RequestInit, accountId?: string) {
    const response = await request(`/api/favorites${path}`, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(accountId ? { "X-AhiBizz-Account-ID": accountId } : {}),
      },
    });
    const data: unknown = await response.json();
    if (!response.ok)
      throw new FavoritesClientError(
        (data as { code?: string })?.code ?? "FAVORITES_UNAVAILABLE",
        response.status,
      );
    return data;
  }
  return {
    async states(ids, actor, signal) {
      const data = await json(`/states?ids=${ids.join(",")}`, { signal }, actor);
      if ((data as { anonymous?: unknown })?.anonymous === true) {
        // An anonymous answer is only valid for a reader that has not displayed an account.
        if (actor) throw new FavoritesClientError("ACCOUNT_IDENTITY_CHANGED", 401);
        throw new FavoritesClientError("AUTHENTICATION_REQUIRED", 401);
      }
      return readFavoriteStates(data);
    },
    async set(id, command, actor) {
      return readFavoriteStates(
        await json(
          `/businesses/${id}`,
          { method: "PUT", body: JSON.stringify(command), signal: AbortSignal.timeout(20000) },
          actor,
        ),
      );
    },
    async list(page, actor, signal) {
      const value = (await json(`?page=${page}`, { signal }, actor)) as FavoritePage;
      if (
        value.accountId !== actor ||
        value.page !== page ||
        typeof value.hasMore !== "boolean" ||
        !Array.isArray(value.items) ||
        value.items.length > 20 ||
        value.items.some(
          (item) =>
            !item ||
            !favoriteId(item.id) ||
            typeof item.title !== "string" ||
            !item.title.trim() ||
            "ownerId" in item ||
            "status" in item ||
            "moderationReturn" in item,
        )
      )
        throw new Error("invalid_favorites_response");
      return value;
    },
  };
}
