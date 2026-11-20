import type { BusinessMediaSummary } from "../lib/business-media";
import {
  PersonBusinessesError,
  type PersonBusinessesPage,
  personBusinessesInput,
  personBusinessesPageSize,
} from "../lib/person-businesses";
import { type PublicBusinessView, publicBusinessImages } from "../lib/public-business";
import { businessMediaProjection } from "./business-media/service";
import { type Database, getDatabase } from "./db";

type ReadDatabase = Pick<Database, "query">;
type CardRow = {
  id: string | null;
  title: string;
  categoryName: string | null;
  subcategoryName: string | null;
  description: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  media?: BusinessMediaSummary;
};
function publicCard(row: CardRow): PublicBusinessView {
  return {
    id: row.id as string,
    title: row.title,
    categoryName: row.categoryName,
    subcategoryName: row.subcategoryName,
    description: row.description,
    addressLine: row.addressLine,
    city: row.city,
    countryCode: row.countryCode,
    latitude: row.latitude,
    longitude: row.longitude,
    verified: row.verified,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    ...publicBusinessImages(row.id as string, row.media),
  };
}

/** One statement checks public-person eligibility and the actual owner FK together. */
export function createPublicPersonBusinessesService(database: ReadDatabase) {
  return {
    async list(personId: string, page = 1): Promise<PersonBusinessesPage> {
      personBusinessesInput(personId, page);
      try {
        const result = await database.query(
          `WITH eligible_person AS (
            SELECT u.id FROM auth_user u
            JOIN personal_profile p ON p.user_id = u.id AND p.is_public = true
            WHERE u.id = $1 AND u.approval = 'approved' AND u."emailVerified" = true
              AND u.role IN ('member', 'owner')
          )
          SELECT business.* FROM eligible_person person
          LEFT JOIN LATERAL (
            SELECT b.id, b.title, c.name AS "categoryName", s.name AS "subcategoryName",
              b.description, b.address_line AS "addressLine", b.city,
              b.country_code AS "countryCode", b.latitude, b.longitude,
              b.is_verified AS verified, ${businessMediaProjection} AS media
            FROM directory_business b
            JOIN directory_category c ON c.id = b.category_id
            LEFT JOIN directory_category s ON s.id = b.subcategory_id AND s.parent_id = c.id
            WHERE b.owner_user_id = person.id AND b.status = 'published' AND package_allows_listing(b)
            ORDER BY b.created_at DESC, b.id DESC LIMIT $2 OFFSET $3
          ) business ON true`,
          [personId, personBusinessesPageSize + 1, (page - 1) * personBusinessesPageSize],
        );
        if (!result.rows.length) throw new PersonBusinessesError(404, "PERSON_NOT_FOUND");
        const rows = (result.rows as CardRow[]).filter((row) => row.id !== null);
        return {
          items: rows.slice(0, personBusinessesPageSize).map(publicCard),
          page,
          hasMore: rows.length > personBusinessesPageSize && page < 999,
        };
      } catch (error) {
        if (error instanceof PersonBusinessesError) throw error;
        throw new PersonBusinessesError(503, "PUBLIC_BUSINESSES_UNAVAILABLE");
      }
    },
  };
}
export type PublicPersonBusinessesService = ReturnType<typeof createPublicPersonBusinessesService>;
export function getPublicPersonBusinessesService(database: Database = getDatabase()) {
  return database.configured() ? createPublicPersonBusinessesService(database) : null;
}
