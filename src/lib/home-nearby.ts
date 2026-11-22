import { readBusinessDetails } from "./business-details";
import { initialLocationPoint, type LocationPoint } from "./business-location";
import type { BusinessMediaSummary } from "./business-media";
import { nearbyQueryPoint } from "./device-location";
import { type PublicBusinessView, publicBusinessImages } from "./public-business";
import { readReviewSummary } from "./reviews";

export const nearbyRadiusKm = 25;
export function nearbyDirectoryPath(point: LocationPoint): string {
  const query = nearbyQueryPoint(point);
  return `/api/directory/businesses?${new URLSearchParams({
    latitude: String(query.latitude),
    longitude: String(query.longitude),
    radiusKm: String(nearbyRadiusKm),
  })}`;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function optionalText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) throw new Error("INVALID_NEARBY_RESULT");
  return value;
}
export function readNearbyBusinesses(
  input: unknown,
  categories: readonly { id: string; name: string; parentId: string | null }[],
  page = 1,
): PublicBusinessView[] {
  return readHomeCardPage(input, categories, { page, pageSize: 20, requireCoordinates: true })
    .items;
}

export function readHomeCardPage(
  input: unknown,
  categories: readonly { id: string; name: string; parentId: string | null }[],
  {
    page,
    pageSize,
    requireCoordinates = false,
  }: {
    page: number;
    pageSize: number;
    requireCoordinates?: boolean;
  },
) {
  if (
    !object(input) ||
    !Array.isArray(input.items) ||
    input.items.length > pageSize ||
    input.page !== page ||
    input.pageSize !== pageSize ||
    typeof input.hasMore !== "boolean"
  )
    throw new Error("INVALID_NEARBY_RESULT");
  const items: PublicBusinessView[] = input.items.map((row: unknown) => {
    if (
      !object(row) ||
      typeof row.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.id) ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      row.title.length > 120 ||
      typeof row.categoryId !== "string" ||
      (row.subcategoryId !== null && typeof row.subcategoryId !== "string") ||
      typeof row.verified !== "boolean" ||
      ["ownerId", "status", "version", "moderationReturn"].some((key) => Object.hasOwn(row, key))
    )
      throw new Error("INVALID_NEARBY_RESULT");
    const point = initialLocationPoint(row.latitude, row.longitude);
    if (!point && (requireCoordinates || row.latitude !== null || row.longitude !== null))
      throw new Error("INVALID_NEARBY_RESULT");
    return {
      id: row.id,
      title: row.title,
      categoryName: categories.find((category) => category.id === row.categoryId)?.name ?? null,
      subcategoryName:
        categories.find((category) => category.id === row.subcategoryId)?.name ?? null,
      description: optionalText(row.description, 4000),
      contactEmail: optionalText(row.contactEmail, 254),
      contactPhone: optionalText(row.contactPhone, 40),
      websiteUrl: optionalText(row.websiteUrl, 2048),
      addressLine: optionalText(row.addressLine, 200),
      city: optionalText(row.city, 100),
      countryCode: optionalText(row.countryCode, 2),
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      verified: row.verified,
      featured: row.featured === true,
      localFeatured: row.localFeatured === true,
      details: row.details == null ? null : readBusinessDetails(row.details),
      reviews: row.reviews == null ? { count: 0, sum: 0 } : readReviewSummary(row.reviews),
      ...publicBusinessImages(row.id, row.media as BusinessMediaSummary | undefined),
    };
  });
  return { items, hasMore: input.hasMore };
}

export async function fetchNearbyPages(
  path: string,
  categories: Parameters<typeof readNearbyBusinesses>[1],
  firstPage: number,
  lastPage: number,
  signal: AbortSignal,
) {
  const items: PublicBusinessView[] = [];
  let page = firstPage;
  let hasMore = false;
  while (page <= lastPage) {
    signal.throwIfAborted();
    const response = await fetch(page === 1 ? path : `${path}&page=${page}`, {
      signal,
      cache: "no-store",
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
    });
    if (!response.ok) throw new Error("DIRECTORY_UNAVAILABLE");
    const result: unknown = await response.json();
    signal.throwIfAborted();
    items.push(...readNearbyBusinesses(result, categories, page));
    hasMore = object(result) && result.hasMore === true;
    if (page === lastPage || !hasMore) break;
    page++;
  }
  return { items, page, hasMore };
}
