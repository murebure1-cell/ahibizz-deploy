import type { PoolClient } from "pg";
import {
  type AccountOverviewFacts,
  type OverviewBusiness,
  overviewBusinessLimit,
} from "../lib/account-overview";
import { isPackageId, packageBusinessLimit } from "../lib/packages";
import { readNextAppointment } from "./customer-next-appointment";
import { activePromotionSql } from "./promotions/read";

/** The caller has verified and locked this signed-in actor in the same transaction. */
export async function readOwnerOverview(
  client: PoolClient,
  accountId: string,
): Promise<AccountOverviewFacts> {
  const result = await client.query<
    Omit<AccountOverviewFacts, "package" | "businessLimit" | "businessList" | "nextAppointment"> & {
      role: string;
      founder: boolean;
      held: string;
    }
  >(
    `SELECT u.id AS "accountId", to_char(u."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "joinedAt",
       u.role, u.founder, COALESCE((SELECT package FROM account_package p WHERE p.user_id=u.id),'basic') AS held,
       stats.businesses, stats."promotedBusinesses",
       (SELECT count(*)::integer FROM people_connection c
          WHERE c.status='accepted' AND u.id IN (c.left_user_id,c.right_user_id)) AS friends,
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
           (count(*) FILTER (WHERE b.status='published' AND (${activePromotionSql("b", "home")} OR ${activePromotionSql("b", "nearby")} OR ${activePromotionSql("b", "category")} OR ${activePromotionSql("b", "banner")})))::integer AS "promotedBusinesses"
         FROM directory_business b WHERE b.owner_user_id=u.id AND b.deleted_at IS NULL AND b.status<>'archived'
       ) stats WHERE u.id=$1`,
    [accountId],
  );
  if (!result.rows[0]) throw new Error("Account overview unavailable");
  const { role, founder, held, ...facts } = result.rows[0];
  const list = await client.query<OverviewBusiness>(
    `SELECT id,title,status FROM directory_business
      WHERE owner_user_id=$1 AND deleted_at IS NULL AND status<>'archived'
      ORDER BY (status='published') DESC, updated_at DESC, id LIMIT $2`,
    [accountId, overviewBusinessLimit],
  );
  const limited = role === "member" && !founder && isPackageId(held) ? held : null;
  return {
    ...facts,
    businessList: list.rows,
    // The founder shows Business (his wish, 2026-11-26) and keeps no business limit.
    package: founder ? "business" : limited,
    businessLimit: limited ? packageBusinessLimit(limited) : null,
    nextAppointment: await readNextAppointment(client, accountId),
  };
}
