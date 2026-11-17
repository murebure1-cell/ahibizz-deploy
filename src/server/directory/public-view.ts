import { type PublicBusinessView, publicBusinessImages } from "../../lib/public-business";
import type { DirectoryCategory, PublicDirectoryBusiness } from "./types";

export function publicBusinessView(
  business: PublicDirectoryBusiness,
  categories: DirectoryCategory[],
): PublicBusinessView {
  return {
    id: business.id,
    title: business.title,
    categoryName: categories.find((item) => item.id === business.categoryId)?.name ?? null,
    subcategoryName: categories.find((item) => item.id === business.subcategoryId)?.name ?? null,
    description: business.description,
    contactEmail: business.contactEmail,
    contactPhone: business.contactPhone,
    websiteUrl: business.websiteUrl,
    addressLine: business.addressLine,
    city: business.city,
    countryCode: business.countryCode,
    latitude: business.latitude,
    longitude: business.longitude,
    verified: business.verified,
    details: business.details ?? null,
    reviews: business.reviews ?? { count: 0, sum: 0 },
    ...publicBusinessImages(business.id, business.media),
  };
}
