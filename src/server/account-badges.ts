import type { Pool } from "pg";
import type { BadgeCounts } from "../lib/badges";

type Row = {
  rank: number;
  joined: Date;
  profile: boolean;
  reviews: number;
  categories: number;
  saves: number;
  top: boolean;
  visits: number;
};

/** What the badges of one account are counted from; null when there is no such account. */
export async function readBadgeCounts(pool: Pool, userId: string): Promise<BadgeCounts | null> {
  const row = (
    await pool.query<Row>(
      `SELECT
        (SELECT count(*)::integer FROM auth_user o
          WHERE o."createdAt" < u."createdAt" OR (o."createdAt" = u."createdAt" AND o.id <= u.id)) AS rank,
        u."createdAt" AS joined,
        (EXISTS(SELECT 1 FROM personal_profile_image i WHERE i.user_id=u.id AND i.kind='photo')
          AND EXISTS(SELECT 1 FROM personal_profile p WHERE p.user_id=u.id AND p.bio IS NOT NULL AND p.city IS NOT NULL)) AS profile,
        (SELECT count(*)::integer FROM business_review r
          WHERE r.author_user_id=u.id AND NOT r.withdrawn AND NOT r.hidden) AS reviews,
        (SELECT count(DISTINCT b.category_id)::integer FROM business_review r
          JOIN directory_business b ON b.id=r.business_id
          WHERE r.author_user_id=u.id AND NOT r.withdrawn AND NOT r.hidden) AS categories,
        COALESCE((SELECT max(s.n) FROM (SELECT count(*)::integer AS n FROM business_favorite f
          JOIN directory_business b ON b.id=f.business_id
          WHERE b.owner_user_id=u.id AND f.saved GROUP BY b.id) s), 0) AS saves,
        COALESCE((SELECT bool_or(s.n >= 20 AND s.mean >= 4.7) FROM (SELECT count(*) AS n, avg(r.rating) AS mean
          FROM business_review r JOIN directory_business b ON b.id=r.business_id
          WHERE b.owner_user_id=u.id AND NOT r.withdrawn AND NOT r.hidden GROUP BY b.id) s), false) AS top,
        (SELECT count(*)::integer FROM booking_entry e
          WHERE e.customer_user_id=u.id AND e.kind='customer' AND e.status='completed') AS visits
       FROM auth_user u WHERE u.id=$1`,
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    rank: row.rank,
    joinedAt: row.joined.toISOString(),
    profileComplete: row.profile,
    reviews: row.reviews,
    reviewedCategories: row.categories,
    saves: row.saves,
    topRated: row.top,
    visits: row.visits,
  };
}
