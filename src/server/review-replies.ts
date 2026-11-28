import type { Pool } from "pg";
import { reviewBusinessEligibility, reviewVisibility } from "./reviews/projection";

export type ReviewReply = { reviewId: string; text: string; updatedAt: string };

// A review that is publicly visible on a publicly visible business: the only kind that is
// answered or whose answer is shown.
const visibleReview = `FROM business_review r
  JOIN directory_business b ON b.id=r.business_id
  JOIN auth_user o ON o.id=b.owner_user_id
  JOIN auth_user a ON a.id=r.author_user_id
  WHERE ${reviewBusinessEligibility} AND ${reviewVisibility}`;

/** The owner's answers under a business's visible reviews, newest first. */
export async function listReviewReplies(pool: Pool, businessId: string): Promise<ReviewReply[]> {
  const rows = (
    await pool.query<{ review_id: string; body: string; updated_at: Date }>(
      `SELECT rr.review_id,rr.body,rr.updated_at FROM business_review_reply rr
       WHERE rr.review_id IN (SELECT r.id ${visibleReview} AND b.id=$1)
       ORDER BY rr.updated_at DESC,rr.review_id LIMIT 500`,
      [businessId],
    )
  ).rows;
  return rows.map((row) => ({
    reviewId: row.review_id,
    text: row.body,
    updatedAt: row.updated_at.toISOString(),
  }));
}

/**
 * Writes, replaces or (with an empty text) removes the answer to one review. Only the owner of
 * the review's business may, and only while the review is publicly visible. False means the
 * review is not one this account can answer; nothing is said about why.
 */
export async function saveReviewReply(
  pool: Pool,
  actorId: string,
  reviewId: string,
  text: string,
): Promise<boolean> {
  const target = `SELECT r.id ${visibleReview} AND r.id=$1 AND b.owner_user_id=$2`;
  if (!text) {
    const mine = ((await pool.query(target, [reviewId, actorId])).rowCount ?? 0) > 0;
    if (mine) await pool.query("DELETE FROM business_review_reply WHERE review_id=$1", [reviewId]);
    return mine;
  }
  const saved = await pool.query(
    `INSERT INTO business_review_reply (review_id,author_user_id,body)
     SELECT t.id,$2,$3 FROM (${target}) t
     ON CONFLICT (review_id) DO UPDATE SET body=EXCLUDED.body,author_user_id=EXCLUDED.author_user_id,updated_at=now()`,
    [reviewId, actorId, text],
  );
  return (saved.rowCount ?? 0) > 0;
}
