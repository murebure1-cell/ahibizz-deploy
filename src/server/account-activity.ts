import type { ActivityRow } from "../lib/activity";
import { businessUuid } from "../lib/business-today";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { getAuthDatabasePool, getAuthService } from "./auth/service";

const fields = `a.id,a.version,a.kind,a.action,a.subject_id AS "subjectId",a.business_id AS "businessId",
  b.title AS "businessTitle",a.owner_side AS "ownerSide",a.created_at::text AS "happenedAt",
  (a.read_at IS NULL AND COALESCE(m.read_sequence<a.version,true)) AS unread,
  CASE WHEN t.kind='person' THEN CASE WHEN t.left_user_id=$1 THEN t.right_user_id ELSE t.left_user_id END END AS "personId",
  COALESCE(service.service_name,rental.vehicle_name,stay.unit_name,reel.title) AS "subjectName",
  COALESCE(service.starts_at,rental.starts_at)::text AS "startsAt",service.timezone`;
const visible = `FROM account_activity a
  LEFT JOIN message_thread t ON a.kind='message' AND t.id=a.subject_id
  LEFT JOIN message_thread_member m ON m.thread_id=t.id AND m.user_id=$1
  LEFT JOIN directory_business b ON b.id=COALESCE(a.business_id,t.business_id)
  LEFT JOIN booking_entry service ON a.kind='service' AND service.id=a.subject_id
  LEFT JOIN rental_booking rental ON a.kind='rental' AND rental.id=a.subject_id
  LEFT JOIN stay_booking stay ON a.kind='stay' AND stay.id=a.subject_id
  LEFT JOIN business_reel reel ON a.kind='reel' AND reel.id=a.subject_id
  WHERE a.recipient_id=$1
    AND ((NOT a.owner_side AND a.kind<>'reel') OR (b.owner_user_id=$1 AND b.deleted_at IS NULL))
    AND (a.kind<>'message' OR (
      m.user_id IS NOT NULL AND NOT m.blocked AND NOT people_contact_blocked(t.left_user_id,t.right_user_id)
      AND (t.kind='person' OR (
        b.deleted_at IS NULL AND b.owner_user_id=t.right_user_id AND b.status='published'
       
        AND NOT EXISTS (SELECT 1 FROM message_thread_member other WHERE other.thread_id=t.id AND other.blocked)
      ))
    ))`;
const pageSize = 24;

function context() {
  const auth = getAuthService();
  const pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "ACTIVITY_UNAVAILABLE");
  return { access: createAccountAccess(auth), pool };
}

export async function readActivity(headers: Headers, page: number, selectedId?: string) {
  const { access, pool } = context();
  const session = await access.session(headers);
  return accountTransaction(pool, async (client) => {
    const actor = await access.authority(client, session, false, "read");
    const result = await client.query<ActivityRow>(
      `SELECT ${fields} ${visible} ORDER BY a.created_at DESC,a.id DESC LIMIT $2 OFFSET $3`,
      [actor.id, pageSize + 1, (page - 1) * pageSize],
    );
    const unread = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (
         SELECT 1 ${visible} AND a.read_at IS NULL AND COALESCE(m.read_sequence<a.version,true) LIMIT 100
       ) unread`,
      [actor.id],
    );
    const items = result.rows.slice(0, pageSize);
    if (businessUuid(selectedId) && !items.some((row) => row.id === selectedId)) {
      const chosen = await client.query<ActivityRow>(`SELECT ${fields} ${visible} AND a.id=$2`, [
        actor.id,
        selectedId,
      ]);
      if (chosen.rows[0]) items.unshift(chosen.rows[0]);
    }
    return {
      accountId: actor.id,
      items,
      hasMore: result.rows.length > pageSize,
      unread: unread.rows[0]?.count ?? 0,
    };
  });
}

export async function markActivityRead(
  headers: Headers,
  expectedAccountId: string,
  selection?: { id: string; version: number },
) {
  const { access, pool } = context();
  const bound = new Headers(headers);
  bound.set("X-AhiBizz-Account-ID", expectedAccountId);
  const session = await access.session(bound);
  return accountTransaction(pool, async (client) => {
    const actor = await access.authority(client, session, false, "read");
    if (!selection) {
      await client.query(
        "UPDATE account_activity SET read_at=clock_timestamp() WHERE recipient_id=$1 AND read_at IS NULL",
        [actor.id],
      );
      return null;
    }
    if (!businessUuid(selection.id) || !Number.isSafeInteger(selection.version)) return null;
    const row = (
      await client.query<ActivityRow>(`SELECT ${fields} ${visible} AND a.id=$2`, [
        actor.id,
        selection.id,
      ])
    ).rows[0];
    if (!row) return null;
    await client.query(
      "UPDATE account_activity SET read_at=clock_timestamp() WHERE recipient_id=$1 AND id=$2 AND version=$3 AND read_at IS NULL",
      [actor.id, selection.id, selection.version],
    );
    return row;
  });
}
