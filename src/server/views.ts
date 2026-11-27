/**
 * Day counts of opened public profiles and published businesses (migration 0060). Only a number
 * per page and day is kept. An owner opening their own page is not counted; the browser sends
 * each page once per session (ViewBeacon).
 */
export type ViewKind = "person" | "business";
/** Where a business visitor came from (migration 0063), read from the page they left. */
export const viewSources = ["search", "category", "map", "other"] as const;
export type ViewSource = (typeof viewSources)[number];
export const touchKinds = ["call", "message", "map"] as const;
export type TouchKind = (typeof touchKinds)[number];
type Query = {
  query(text: string, values?: unknown[]): Promise<{ rowCount?: number | null }>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accountId = /^[A-Za-z0-9_-]{1,128}$/;
const today = "(clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::date";

export function viewTarget(kind: unknown, id: unknown): { kind: ViewKind; id: string } | null {
  if (kind === "business" && typeof id === "string" && uuid.test(id))
    return { kind, id: id.toLowerCase() };
  if (kind === "person" && typeof id === "string" && accountId.test(id)) return { kind, id };
  return null;
}

/** Counts one view; returns whether it was counted (a hidden page or a self-view is not). */
export async function recordView(
  database: Query,
  target: { kind: ViewKind; id: string },
  viewerId: string | null,
  source: ViewSource = "other",
): Promise<boolean> {
  const result =
    target.kind === "business"
      ? await database.query(
          `INSERT INTO business_view_day (business_id, day, views)
           SELECT b.id, ${today}, 1 FROM directory_business b JOIN auth_user u ON u.id=b.owner_user_id
           WHERE b.id=$1 AND b.deleted_at IS NULL AND b.status='published'
             AND u.approval='approved' AND u."emailVerified"
             AND ($2::text IS NULL OR b.owner_user_id<>$2)
           ON CONFLICT (business_id, day) DO UPDATE SET views = business_view_day.views + 1`,
          [target.id, viewerId],
        )
      : await database.query(
          `INSERT INTO profile_view_day (user_id, day, views)
           SELECT u.id, ${today}, 1 FROM auth_user u
           JOIN personal_profile p ON p.user_id=u.id AND p.is_public
           WHERE u.id=$1 AND u.approval='approved' AND u."emailVerified" AND u.erased_at IS NULL
             AND ($2::text IS NULL OR u.id<>$2)
           ON CONFLICT (user_id, day) DO UPDATE SET views = profile_view_day.views + 1`,
          [target.id, viewerId],
        );
  const counted = (result.rowCount ?? 0) > 0;
  if (counted && target.kind === "business") {
    await database.query(
      `INSERT INTO business_source_day (business_id, day, source, views) VALUES ($1, ${today}, $2, 1)
       ON CONFLICT (business_id, day, source) DO UPDATE SET views = business_source_day.views + 1`,
      [target.id, source],
    );
    await database.query(
      `INSERT INTO business_view_hour (business_id, day, hour, views)
       VALUES ($1, ${today}, extract(hour FROM clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::smallint, 1)
       ON CONFLICT (business_id, day, hour) DO UPDATE SET views = business_view_hour.views + 1`,
      [target.id],
    );
  }
  return counted;
}

/** Counts a tap on call, message or map of a published business; an owner's own is not. */
export async function recordTouch(
  database: Query,
  id: string,
  kind: TouchKind,
  viewerId: string | null,
): Promise<boolean> {
  const result = await database.query(
    `INSERT INTO business_touch_day (business_id, day, kind, touches)
     SELECT b.id, ${today}, $2, 1 FROM directory_business b
     WHERE b.id=$1 AND b.deleted_at IS NULL AND b.status='published'
       AND ($3::text IS NULL OR b.owner_user_id<>$3)
     ON CONFLICT (business_id, day, kind) DO UPDATE SET touches = business_touch_day.touches + 1`,
    [id, kind, viewerId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** SQL for the last 30 days (today included) of one account, for the overview. */
export const profileViews30 = (user: string) =>
  `(SELECT COALESCE(sum(v.views),0)::integer FROM profile_view_day v
     WHERE v.user_id=${user} AND v.day > ${today} - 30)`;
export const businessViews30 = (user: string) =>
  `(SELECT COALESCE(sum(v.views),0)::integer FROM business_view_day v
     JOIN directory_business vb ON vb.id=v.business_id
     WHERE vb.owner_user_id=${user} AND vb.deleted_at IS NULL AND v.day > ${today} - 30)`;
