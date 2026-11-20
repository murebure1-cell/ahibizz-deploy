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
  if (
    !object(input) ||
    !Array.isArray(input.items) ||
    input.items.length > 20 ||
    input.page !== page ||
    input.pageSize !== 20 ||
    typeof input.hasMore !== "boolean"
  )
    throw new Error("INVALID_NEARBY_RESULT");
  return input.items.map((row: unknown) => {
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
      !initialLocationPoint(row.latitude, row.longitude) ||
      ["ownerId", "status", "version", "moderationReturn"].some((key) => Object.hasOwn(row, key))
    )
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
      latitude: row.latitude as number,
      longitude: row.longitude as number,
      verified: row.verified,
      localFeatured: row.localFeatured === true,
      details: row.details == null ? null : readBusinessDetails(row.details),
      reviews: row.reviews == null ? { count: 0, sum: 0 } : readReviewSummary(row.reviews),
      ...publicBusinessImages(row.id, row.media as BusinessMediaSummary | undefined),
    };
  });
}
