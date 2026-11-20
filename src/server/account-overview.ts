import type { PoolClient } from "pg";
import type { AccountOverviewFacts, ActivePlacement } from "../lib/account-overview";
import { readNextAppointment } from "./customer-next-appointment";
import {
  creditBalanceSql,
  packagePromotions,
  paidPlacementSql,
  paidPromotions,
} from "./marketing/read";
import { promotionSql } from "./paypal/store";

export async function readOwnerPlacements(client: PoolClient, accountId: string) {
  const promotions = await paidPromotions(client, accountId);
  const placements = await client.query<ActivePlacement>(
    `SELECT b.id, b.title, o.kind, max(o.ends_at)::text AS "endsAt"
    FROM marketing_order o JOIN directory_business b ON b.id=o.business_id AND b.owner_user_id=o.account_id
    WHERE o.account_id=$1 AND b.status='published' AND package_allows_listing(b) AND o.kind IN ('banner','featured','nearby') AND o.status='paid'
      AND o.revoked_at IS NULL AND o.starts_at<=now() AND o.ends_at>now()
      AND (o.kind<>'nearby' OR (b.latitude IS NOT NULL AND b.longitude IS NOT NULL))
      GROUP BY b.id,b.title,o.kind ORDER BY max(o.ends_at),b.id,o.kind LIMIT 200`,
    [accountId],
  );
  const active = new Map<string, ActivePlacement>();
  for (const item of [
    ...promotions.map((row) => ({ ...row, kind: "category" as const })),
    ...placements.rows,
    ...(await packagePromotions(client, accountId)),
  ]) {
    const key = `${item.kind}/${item.id}`;
    const previous = active.get(key);
    if (!previous || Date.parse(item.endsAt) > Date.parse(previous.endsAt)) active.set(key, item);
  }
  const items = [...active.values()].sort(
    (a, b) =>
      Date.parse(a.endsAt) - Date.parse(b.endsAt) ||
      a.id.localeCompare(b.id) ||
      a.kind.localeCompare(b.kind),
  );
  return { accountId, items };
}

/** The caller has verified and locked this signed-in actor in the same transaction. */
export async function readOwnerOverview(
  client: PoolClient,
  accountId: string,
): Promise<AccountOverviewFacts> {
  const result = await client.query<
    Omit<AccountOverviewFacts, "credits"> & { credits: string | number }
  >(
    `SELECT u.id AS "accountId", to_char(u."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "joinedAt",
       stats.businesses, stats."promotedBusinesses", ${creditBalanceSql("u.id")} AS credits,
       (SELECT count(*)::integer FROM message_thread t
          JOIN message_thread_member own ON own.thread_id=t.id AND own.user_id=u.id
          LEFT JOIN directory_business mb ON mb.id=t.business_id
         WHERE u.id IN (t.left_user_id,t.right_user_id)
           AND (t.kind='person' OR mb.owner_user_id=t.right_user_id)
           AND t.latest_sequence>own.read_sequence
           AND EXISTS (SELECT 1 FROM message_message m WHERE m.thread_id=t.id
             AND m.sequence>own.read_sequence AND m.sender_user_id<>u.id)) AS "unreadThreads"
       FROM auth_user u
       CROSS JOIN LATERAL (
         SELECT count(*)::integer AS businesses,
           (count(*) FILTER (WHERE b.status='published' AND package_allows_listing(b) AND (${promotionSql("b")} OR ${paidPlacementSql("featured")} OR (b.latitude IS NOT NULL AND b.longitude IS NOT NULL AND ${paidPlacementSql("nearby")}))))::integer AS "promotedBusinesses"
         FROM directory_business b WHERE b.owner_user_id=u.id AND b.deleted_at IS NULL AND b.status<>'archived'
       ) stats WHERE u.id=$1`,
    [accountId],
  );
  if (!result.rows[0]) throw new Error("Account overview unavailable");
  const credits = Number(result.rows[0].credits);
  if (!Number.isSafeInteger(credits) || credits < 0) throw new Error("Invalid credit balance");
  return {
    ...result.rows[0],
    credits,
    nextAppointment: await readNextAppointment(client, accountId),
  };
}
