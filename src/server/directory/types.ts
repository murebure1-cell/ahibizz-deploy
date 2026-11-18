import type { BusinessDetails } from "../../lib/business-details";
import type { BusinessMediaSummary } from "../../lib/business-media";
import type { ReviewSummary } from "../../lib/reviews";
export type BusinessStatus = "draft" | "pending" | "published" | "archived";
export type DirectoryCategory = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  vehicleRental?: boolean;
};
export type BusinessFields = {
  title: string;
  categoryId: string;
  subcategoryId: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
};
export type DirectoryBusiness = BusinessFields & {
  hasRentalVehicles?: boolean;
  details?: BusinessDetails | null;
  reviews?: ReviewSummary;
  media?: BusinessMediaSummary;
  moderationReturn?: { reason: string; createdAt: string; version: number } | null;
  id: string;
  ownerId: string;
  status: BusinessStatus;
  version: number;
  verified: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
};
export type PublicDirectoryBusiness = Omit<
  DirectoryBusiness,
  | "ownerId"
  | "status"
  | "version"
  | "archivedAt"
  | "updatedAt"
  | "moderationReturn"
  | "hasRentalVehicles"
>;
export class DirectoryAccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Directory action could not be completed.");
  }
}
export function fail(status: number, code: string): never {
  throw new DirectoryAccessError(status, code);
}
