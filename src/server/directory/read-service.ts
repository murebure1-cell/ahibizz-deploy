import { businessMediaProjection } from "../business-media/service";
import type { Database } from "../db";
import { getDatabase } from "../db";
import { paidPlacementSql } from "../marketing/read";
import { promotionSql } from "../paypal/store";
import { businessReviewsProjection } from "../reviews/projection";
import {
  type BusinessFields,
  DirectoryAccessError,
  type DirectoryBusiness,
  type DirectoryCategory,
  fail,
  type PublicDirectoryBusiness,
} from "./types";
import { businessKeys, object, pageInput, uuid } from "./validation";

export type DirectoryReadDatabase = Pick<Database, "query">;
type PromotionFilter = boolean | "category" | "all";
type ListOptions = { maximumPageSize?: number; newestFirst?: boolean };

const publicBusinessWhere =
  "b.status = 'published' AND package_allows_listing(b) AND u.approval = 'approved' AND u.\"emailVerified\" = true";

export async function publicDirectoryCounts() {
  const database = getDatabase();
  try {
    if (!database.configured()) return null;
    const { rows } = await database.query(`
      SELECT count(*)::integer AS businesses, count(DISTINCT b.category_id)::integer AS categories
      FROM directory_business b JOIN auth_user u ON u.id = b.owner_user_id
      WHERE ${publicBusinessWhere}
    `);
    const counts = rows[0];
    return counts
      ? { businesses: Number(counts.businesses), categories: Number(counts.categories) }
      : null;
  } catch {
    return null;
  }
}

export const columnMap: Record<keyof BusinessFields, string> = {
  title: "title",
  categoryId: "category_id",
  subcategoryId: "subcategory_id",
  description: "description",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  websiteUrl: "website_url",
  addressLine: "address_line",
  city: "city",
  countryCode: "country_code",
  latitude: "latitude",
  longitude: "longitude",
};
const publicColumns = [
  "b.id",
  'b.owner_user_id AS "ownerId"',
  ...businessKeys.map((key) => `b.${columnMap[key]} AS "${key}"`),
  "b.status",
  "b.version",
  "b.is_verified AS verified",
  "b.is_featured AS featured",
  'b.created_at AS "createdAt"',
  'b.updated_at AS "updatedAt"',
  'b.published_at AS "publishedAt"',
  'b.archived_at AS "archivedAt"',
  `${businessMediaProjection} AS media`,
  businessReviewsProjection("b"),
  `(SELECT jsonb_build_object('timezone', d.timezone, 'hours', d.hours, 'amenities', d.amenities) FROM directory_business_details d WHERE d.business_id = b.id) AS details`,
].join(", ");
export const columns = [
  publicColumns,
  'NOT package_allows_listing(b) AS "packagePaymentNeeded"',
  'b.editorial_revision AS "editorialRevision"',
  `EXISTS (SELECT 1 FROM directory_business_image_proposal ip WHERE ip.business_id=b.id) AS "pendingMedia"`,
  `(SELECT a.action FROM directory_moderation_audit a WHERE a.business_id=b.id AND a.action IN ('approve-changes','reject-changes') AND a.next_version=b.version LIMIT 1) AS "revisionDecision"`,
  `(SELECT a.reason FROM directory_moderation_audit a WHERE a.business_id=b.id AND a.action='reject-changes' AND a.next_version=b.version) AS "revisionRejection"`,
  `EXISTS (SELECT 1 FROM stay_unit su WHERE su.business_id=b.id AND su.archived_at IS NULL) AS "hasStayUnits"`,
  `EXISTS (SELECT 1 FROM rental_vehicle rv WHERE rv.business_id=b.id AND rv.archived_at IS NULL) AS "hasRentalVehicles"`,
  `(SELECT jsonb_build_object('reason', a.reason, 'createdAt', a.created_at, 'version', b.version) FROM directory_moderation_audit a WHERE b.status = 'draft' AND a.business_id = b.id AND a.action = 'moderate' AND a.next_status = 'draft' AND a.next_version <= b.version AND (a.next_version = b.version OR (SELECT count(*) FROM directory_ownership_transfer ot WHERE ot.business_id=b.id AND ot.previous_version>=a.next_version AND ot.result_version<=b.version)=b.version-a.next_version) AND a.reason IS NOT NULL ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS "moderationReturn"`,
].join(", ");
export type Row = Omit<
  DirectoryBusiness,
  "createdAt" | "updatedAt" | "publishedAt" | "archivedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
};
export function dto(row: Row): DirectoryBusiness {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    moderationReturn: row.moderationReturn
      ? {
          ...row.moderationReturn,
          createdAt: new Date(row.moderationReturn.createdAt).toISOString(),
        }
      : null,
  };
}
export function publicDto(value: DirectoryBusiness): PublicDirectoryBusiness {
  const {
    editorialRevision: _revision,
    pendingMedia: _pendingMedia,
    revisionDecision: _decision,
    revisionRejection: _rejection,
    ownerId: _owner,
    status: _status,
    version: _version,
    archivedAt: _archived,
    updatedAt: _updated,
    moderationReturn: _moderationReturn,
    hasRentalVehicles: _hasRentalVehicles,
    hasStayUnits: _hasStayUnits,
    packagePaymentNeeded: _packagePaymentNeeded,
    ...publicValue
  } = value;
  return publicValue;
}
async function safeRead<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DirectoryAccessError) throw error;
    throw new DirectoryAccessError(503, "DIRECTORY_UNAVAILABLE");
  }
}

// PostgreSQL and the query use the same Bosnian transliteration, including Đ → Dj.
function foldedSearch(column: string) {
  return `translate(replace(replace(normalize(${column}, NFC),'Đ','Dj'),'đ','dj'),'ČĆŠŽčćšž','CCSZccsz')`;
}
function searchPattern(text: string) {
  const folded = text
    .normalize("NFC")
    .replace(/[đĐ]/g, "dj")
    .replace(/[čćČĆ]/g, "c")
    .replace(/[šŠ]/g, "s")
    .replace(/[žŽ]/g, "z");
  return `%${folded.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export async function listDirectory(
  database: DirectoryReadDatabase,
  input: unknown,
  condition: string,
  parameters: unknown[],
  publicOnly = false,
  featuredOnly: PromotionFilter = false,
  checkedAt?: Date,
  blockViewer?: string | null,
  options: ListOptions = {},
) {
  const {
    page,
    pageSize: requestedSize,
    categoryId,
    subcategoryId,
    status,
    q,
    city,
    nearby,
    openNow,
  } = pageInput(input, publicOnly);
  const pageSize = Math.min(requestedSize, options.maximumPageSize ?? requestedSize);
  const filters = [condition, "b.deleted_at IS NULL"],
    values = [...parameters];
  if (publicOnly && blockViewer) {
    const actor = values.push(blockViewer);
    filters.push(
      `NOT EXISTS (SELECT 1 FROM people_block pb WHERE pb.actor_id=$${actor} AND pb.target_id=b.owner_user_id AND pb.blocked)`,
    );
  }
  if (!publicOnly && status === undefined) filters.push("b.status <> 'archived'");
  for (const [column, value] of [
    ["b.category_id", categoryId],
    ["b.subcategory_id", subcategoryId],
    ["b.status", status],
  ] as const)
    if (value) filters.push(`${column} = $${values.push(value)}`);
  const publicationOrder = "b.published_at DESC NULLS LAST, b.id DESC";
  let order = options.newestFirst ? publicationOrder : "b.created_at DESC, b.id DESC";
  if (q) {
    const words = [...new Set(q.split(/\s+/).map(searchPattern))];
    const index = values.push(words);
    const searchable = publicOnly
      ? "concat_ws(' ',b.title,b.city,b.description)"
      : "concat_ws(' ',b.title,b.city,b.description,b.editorial_revision#>>'{fields,title}',b.editorial_revision#>>'{fields,city}',b.editorial_revision#>>'{fields,description}')";
    filters.push(`${foldedSearch(searchable)} ILIKE ALL ($${index}::text[])`);
    order = `(${foldedSearch("b.title")} ILIKE ALL ($${index}::text[])) DESC, ${order}`;
  }
  if (city) {
    const index = values.push(searchPattern(city));
    filters.push(`${foldedSearch("b.city")} ILIKE $${index}`);
  }
  if (openNow) {
    const instant = values.push(checkedAt ?? new Date());
    // The stored week starts on Monday. Midnight-spanning hours are split across both days.
    filters.push(`EXISTS (
      SELECT 1 FROM directory_business_details d
      CROSS JOIN LATERAL (SELECT $${instant}::timestamptz AT TIME ZONE d.timezone AS local_time) clock
      CROSS JOIN LATERAL jsonb_array_elements(
        d.hours -> (EXTRACT(ISODOW FROM clock.local_time)::int - 1) -> 'windows'
      ) win
      WHERE d.business_id = b.id
        AND (win->>'startMinute')::int <= EXTRACT(HOUR FROM clock.local_time) * 60 + EXTRACT(MINUTE FROM clock.local_time)
        AND (win->>'endMinute')::int > EXTRACT(HOUR FROM clock.local_time) * 60 + EXTRACT(MINUTE FROM clock.local_time)
    )`);
  }
  if (nearby) {
    const latitude = values.push(nearby.latitude),
      longitude = values.push(nearby.longitude),
      radius = values.push(nearby.radiusKm);
    // Clamp floating-point drift at antipodes/poles; sine handles the date-line wrap.
    const distance = `6371.0 * 2 * ASIN(SQRT(LEAST(1.0, GREATEST(0.0, POWER(SIN(RADIANS(b.latitude - $${latitude}::double precision) / 2), 2) + COS(RADIANS($${latitude}::double precision)) * COS(RADIANS(b.latitude)) * POWER(SIN(RADIANS(b.longitude - $${longitude}::double precision) / 2), 2)))))`;
    filters.push("b.latitude IS NOT NULL AND b.longitude IS NOT NULL");
    filters.push(`(${distance}) <= $${radius}::double precision`);
    order = `(${distance}) ASC, b.id ASC`;
  }
  const paidCategory =
    publicOnly && (Boolean(categoryId) || featuredOnly === "category" || featuredOnly === "all");
  const paid = paidCategory
    ? promotionSql("b", process.env.PAYPAL_CHECKOUT_FULFILLMENT_READY === "true")
    : null;
  if (paid) order = `(${paid}) DESC, ${order}`;
  const includeLocal = publicOnly && (nearby || city || featuredOnly === "all");
  const localPlacement = includeLocal
    ? `(b.latitude IS NOT NULL AND b.longitude IS NOT NULL AND ${paidPlacementSql("nearby")})`
    : null;
  if (localPlacement) order = `"localFeatured" DESC, ${order}`;
  if (publicOnly && featuredOnly === "all") {
    filters.push(`(${paid} OR ${localPlacement} OR ${paidPlacementSql("featured")})`);
    // Keep pages consistent while the home rail appends more results.
    order = publicationOrder;
  } else if (publicOnly && featuredOnly) {
    filters.push(featuredOnly === "category" ? (paid ?? "FALSE") : paidPlacementSql("featured"));
    // Stable within an hour for scrolling/pagination, then gives other paid profiles the lead.
    order = "md5(b.id::text || floor(extract(epoch FROM now())/3600)::text), b.id";
  }
  let selectedColumns =
    publicOnly && paid
      ? publicColumns.replace("b.is_featured AS featured", `(${paid}) AS featured`)
      : publicOnly
        ? publicColumns
        : columns;
  if (publicOnly && featuredOnly === "all")
    selectedColumns = publicColumns.replace("b.is_featured AS featured", "TRUE AS featured");
  if (localPlacement) selectedColumns += `, ${localPlacement} AS "localFeatured"`;
  const fromWhere = `FROM directory_business b ${publicOnly ? "JOIN auth_user u ON u.id = b.owner_user_id" : ""} WHERE ${filters.join(" AND ")}`;
  if (openNow) selectedColumns += ', COUNT(*) OVER()::int AS "openCount"';
  const limitIndex = values.push(pageSize + 1),
    offsetIndex = values.push((page - 1) * pageSize);
  const result = await database.query(
    `SELECT ${selectedColumns} ${fromWhere} ORDER BY ${order} LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  );
  const items = (result.rows as (Row & { openCount?: number })[])
    .slice(0, pageSize)
    .map(({ openCount: _count, ...row }) => dto(row));
  let total: number | undefined;
  if (openNow) {
    total = Number(result.rows[0]?.openCount ?? 0);
    if (page > 1 && !result.rows.length) {
      const count = await database.query(
        `SELECT COUNT(*)::int AS total ${fromWhere}`,
        values.slice(0, -2),
      );
      total = Number(count.rows[0]?.total ?? 0);
    }
  }
  return {
    items,
    page,
    pageSize,
    hasMore: result.rows.length > pageSize,
    ...(total !== undefined ? { total } : {}),
  };
}

/** Public queries require only the configured database, never an auth or mail service. */
export function createPublicDirectoryService({
  database,
  now = () => new Date(),
}: {
  database: DirectoryReadDatabase;
  now?: () => Date;
}) {
  function queryPublic(
    input: unknown,
    featuredOnly: PromotionFilter = false,
    blockViewer?: string | null,
    options?: ListOptions,
  ) {
    return safeRead(async () => {
      const checkedAt = now();
      const result = await listDirectory(
        database,
        input,
        publicBusinessWhere,
        [],
        true,
        featuredOnly,
        checkedAt,
        blockViewer,
        options,
      );
      return {
        ...result,
        checkedAt: checkedAt.toISOString(),
        items: result.items.map(publicDto),
      };
    });
  }
  return {
    categories: () =>
      safeRead(async () => ({
        categories: (
          await database.query(
            `SELECT c.id, c.name, c.slug, c.parent_id AS "parentId",
                    (c.vehicle_rental OR COALESCE(p.vehicle_rental, false)) AS "vehicleRental",
                    (c.accommodation OR COALESCE(p.accommodation,false)) AS accommodation
               FROM directory_category c LEFT JOIN directory_category p ON p.id = c.parent_id
              ORDER BY c.parent_id NULLS FIRST, c.name, c.id`,
          )
        ).rows as DirectoryCategory[],
      })),
    async listPublic(
      input: unknown = {},
      featuredOnly: PromotionFilter = false,
      blockViewer?: string | null,
    ) {
      object(input, [
        "page",
        "pageSize",
        "categoryId",
        "subcategoryId",
        "q",
        "city",
        "latitude",
        "longitude",
        "radiusKm",
        "openNow",
      ]);
      return queryPublic(input, featuredOnly, blockViewer);
    },
    homeAllPromotions(page = 1) {
      return queryPublic({ page }, "all", null, { maximumPageSize: 6 });
    },
    async homeNewest(blockViewer?: string | null) {
      const result = await queryPublic({}, false, blockViewer, {
        maximumPageSize: 6,
        newestFirst: true,
      });
      return result.items;
    },
    async readPublic(id: string): Promise<PublicDirectoryBusiness> {
      const key = uuid(id);
      return safeRead(async () => {
        const result = await database.query(
          `SELECT ${publicColumns} FROM directory_business b JOIN auth_user u ON u.id = b.owner_user_id WHERE b.id = $1 AND ${publicBusinessWhere}`,
          [key],
        );
        if (!result.rows[0]) fail(404, "BUSINESS_NOT_FOUND");
        return publicDto(dto(result.rows[0] as Row));
      });
    },
  };
}

export type PublicDirectoryService = ReturnType<typeof createPublicDirectoryService>;

/** The shared database facade remains lazy and does not open a connection here. */
export function getPublicDirectoryService(
  database: Database = getDatabase(),
): PublicDirectoryService | null {
  return database.configured() ? createPublicDirectoryService({ database }) : null;
}
