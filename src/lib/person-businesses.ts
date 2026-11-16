import type { PublicBusinessView } from "./public-business";

export const personBusinessesPageSize = 12;
export type PersonBusinessesPage = {
  items: PublicBusinessView[];
  page: number;
  hasMore: boolean;
};
export type PersonBusinessesRequest = (
  personId: string,
  page: number,
  options?: { signal?: AbortSignal },
) => Promise<PersonBusinessesPage>;

export class PersonBusinessesError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Public businesses could not be loaded.");
  }
}
export function personBusinessesInput(personId: string, page: number) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(personId) || !Number.isInteger(page) || page < 1 || page > 999)
    throw new PersonBusinessesError(400, "INVALID_PERSON_BUSINESSES_INPUT");
}
export function readPersonBusinessesPage(value: unknown, page: number): PersonBusinessesPage {
  if (!value || typeof value !== "object") throw new PersonBusinessesError(503, "UNAVAILABLE");
  const data = value as PersonBusinessesPage;
  if (
    data.page !== page ||
    typeof data.hasMore !== "boolean" ||
    !Array.isArray(data.items) ||
    data.items.length > personBusinessesPageSize ||
    new Set(data.items.map((item) => item?.id)).size !== data.items.length ||
    data.items.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(item.id) ||
        typeof item.title !== "string" ||
        !item.title.trim() ||
        item.title.length > 120 ||
        typeof item.verified !== "boolean" ||
        [
          item.categoryName,
          item.subcategoryName,
          item.description,
          item.addressLine,
          item.city,
          item.countryCode,
          item.contactEmail,
          item.contactPhone,
          item.websiteUrl,
        ].some((field) => field !== null && typeof field !== "string") ||
        [item.latitude, item.longitude].some(
          (field) => field !== null && (typeof field !== "number" || !Number.isFinite(field)),
        ),
    )
  )
    throw new PersonBusinessesError(503, "UNAVAILABLE");
  return {
    page: data.page,
    hasMore: data.hasMore,
    items: data.items.map((item) => ({
      id: item.id,
      title: item.title,
      categoryName: item.categoryName,
      subcategoryName: item.subcategoryName,
      description: item.description,
      addressLine: item.addressLine,
      city: item.city,
      countryCode: item.countryCode,
      latitude: item.latitude,
      longitude: item.longitude,
      verified: item.verified,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      ...(item.logo ? { logo: item.logo } : {}),
      ...(item.image ? { image: item.image } : {}),
    })),
  };
}
export const personBusinessesRequest: PersonBusinessesRequest = async (
  personId,
  page,
  options = {},
) => {
  personBusinessesInput(personId, page);
  const response = await fetch(
    `/api/public-people/${encodeURIComponent(personId)}/businesses?page=${page}`,
    {
      signal: options.signal,
      cache: "no-store",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new PersonBusinessesError(
      response.status,
      typeof data?.code === "string" ? data.code : "UNAVAILABLE",
    );
  return readPersonBusinessesPage(data, page);
};
