import type { PoolClient } from "pg";
import type { AdminTodayRow } from "../lib/admin-today";

/** Read one database snapshot. A business with both editorial and image proposals is one decision. */
export async function readAdminTodayQueues(client: PoolClient): Promise<AdminTodayRow[]> {
  const { rows } = await client.query<Omit<AdminTodayRow, "oldestAt"> & { oldestAt: Date | null }>(`
    SELECT 'accounts' AS id, count(*)::int AS count, min("createdAt") AS "oldestAt"
    FROM auth_user WHERE approval='pending' AND role='member' AND "emailVerified"
    UNION ALL
    SELECT 'businesses', count(*)::int, min(least(CASE WHEN b.status='pending' OR b.editorial_revision IS NOT NULL THEN b.updated_at END, images.oldest))
    FROM directory_business b
    LEFT JOIN (SELECT business_id,min(updated_at) AS oldest FROM directory_business_image_proposal GROUP BY business_id) images ON images.business_id=b.id
    WHERE b.deleted_at IS NULL AND (b.status='pending' OR b.editorial_revision IS NOT NULL OR images.business_id IS NOT NULL)
    UNION ALL
    SELECT 'reports',count(*)::int,min(created_at) FROM support_request WHERE resolved_at IS NULL
    UNION ALL
    SELECT 'promotions',count(*)::int,min(created_at) FROM promotion_order WHERE status='pending'
      AND GREATEST(starts_at, created_at + interval '3 days')>clock_timestamp()

  `);
  return rows.map((row) => ({ ...row, oldestAt: row.oldestAt?.toISOString() ?? null }));
}
