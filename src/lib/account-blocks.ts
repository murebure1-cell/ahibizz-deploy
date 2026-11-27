import { msg } from "./i18n/translate";
export const blockedPeoplePath = "/blokirani-korisnici";
export type BlockState = { blockedByMe: boolean; canContact: boolean; version: number };
export type BlockedPerson = { id: string; name: string; version: number; blockedAt?: string };
export type BlockedPeople = {
  items: BlockedPerson[];
  page: number;
  hasMore: boolean;
  hideInSearch: boolean;
};

export class BlockRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Block request could not be completed.");
  }
}

export async function blocksRequest<T>(
  accountId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-AhiBizz-Account-ID", accountId);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/account/blocks${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object")
    throw new BlockRequestError(response.status, typeof data?.code === "string" ? data.code : "");
  return data as T;
}

export function blockRequestMessage(error: unknown) {
  if (error instanceof BlockRequestError) {
    if (error.status === 401 || error.status === 403)
      return msg("Prijavi se ponovo za pristup blokiranim korisnicima.");
    if (error.status === 404) return msg("Ovaj korisnik trenutno nije dostupan.");
    if (error.code === "BLOCK_VERSION_CONFLICT")
      return msg("Postavka se promijenila. Učitaj trenutno stanje.");
  }
  return msg("Postavku trenutno nije moguće potvrditi.");
}
