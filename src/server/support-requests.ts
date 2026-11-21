import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { type SupportSubject, supportTarget } from "../lib/support-requests";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";
import { reviewBusinessEligibility, reviewVisibility } from "./reviews/projection";

const reportUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const reportTargetQueries = {
  person: `SELECT 1 FROM auth_user a JOIN personal_profile p ON p.user_id=a.id
    WHERE a.id=$1 AND p.is_public AND a.approval='approved' AND a."emailVerified"=true
      AND a.role IN ('member','owner')`,
  business: `SELECT 1 FROM directory_business b JOIN auth_user o ON o.id=b.owner_user_id
    WHERE b.id=$1 AND ${reviewBusinessEligibility}`,
  review: `SELECT 1 FROM business_review r JOIN directory_business b ON b.id=r.business_id
    JOIN auth_user o ON o.id=b.owner_user_id JOIN auth_user a ON a.id=r.author_user_id
    WHERE r.id=$1 AND ${reviewBusinessEligibility} AND ${reviewVisibility}`,
  // Blocking keeps the history accessible to existing participants for reporting.
  conversation: `SELECT 1 FROM message_thread t
    JOIN message_thread_member own ON own.thread_id=t.id AND own.user_id=$2
    JOIN message_thread_member peer ON peer.thread_id=t.id
      AND peer.user_id=CASE WHEN t.left_user_id=$2 THEN t.right_user_id ELSE t.left_user_id END
    WHERE t.id=$1 AND $2 IN (t.left_user_id,t.right_user_id)
      AND (t.kind='person' OR EXISTS (
        SELECT 1 FROM directory_business b WHERE b.id=t.business_id AND b.owner_user_id=t.right_user_id
      ))`,
} as const;

export type OpenSupportRequest = {
  id: string;
  subject: SupportSubject;
  reference: string;
  details: string;
  email: string;
  name: string;
};
export function createSupportRequests(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return {
    async submit(headers: Headers, subject: unknown, reference: unknown, details: unknown) {
      const target = supportTarget(subject, reference);
      if (
        !target ||
        typeof details !== "string" ||
        details.length > 800 ||
        (target.subject !== "deletion" && !details.trim())
      )
        throw new AccountAccessError(400, "INVALID_REQUEST");
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current);
        const subject = target.subject;
        const uuidTarget =
          subject === "business" || subject === "review" || subject === "conversation";
        const canonical = uuidTarget && reportUuid.test(target.reference);
        const reference = canonical ? target.reference.toLowerCase() : target.reference;
        const existing = await client.query(
          `SELECT id FROM support_request WHERE actor_id=$1 AND subject=$2
            AND ${canonical ? "lower(reference)" : "reference"}=$3
            AND (subject='help' OR resolved_at IS NULL)`,
          [actor.id, subject, reference],
        );
        if (existing.rowCount) return;
        if (subject !== "deletion") {
          const recent = await client.query(
            "SELECT count(*)::int AS count FROM support_request WHERE actor_id=$1 AND subject<>'deletion' AND created_at > now() - interval '1 day'",
            [actor.id],
          );
          if (recent.rows[0].count >= 10) throw new AccountAccessError(429, "TOO_MANY_REQUESTS");
        }
        if (subject !== "help" && subject !== "deletion") {
          if (uuidTarget && !canonical)
            throw new AccountAccessError(404, "REPORT_TARGET_UNAVAILABLE");
          const visible = await client.query(
            reportTargetQueries[subject],
            subject === "conversation" ? [reference, actor.id] : [reference],
          );
          if (!visible.rowCount) throw new AccountAccessError(404, "REPORT_TARGET_UNAVAILABLE");
        }
        await client.query(
          "INSERT INTO support_request(id,actor_id,subject,reference,details) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            actor.id,
            subject,
            reference,
            subject === "deletion" ? "" : details.trim(),
          ],
        );
      });
    },
    async pending(headers: Headers, page: number) {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        await access.authority(client, current, true);
        const result = await client.query<OpenSupportRequest>(
          "SELECT r.id,r.subject,r.reference,r.details,u.name,u.email FROM support_request r JOIN auth_user u ON u.id=r.actor_id WHERE r.resolved_at IS NULL ORDER BY r.created_at,r.id LIMIT 31 OFFSET $1",
          [page * 30],
        );
        return { requests: result.rows.slice(0, 30), more: result.rows.length > 30 };
      });
    },
    async resolve(headers: Headers, id: string) {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
        throw new AccountAccessError(400, "INVALID_REQUEST");
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, current, true);
        // Deletion requests close through actual account deletion (FK cascade).
        const result = await client.query(
          "UPDATE support_request SET resolved_at=now(),resolved_by=$1 WHERE id=$2 AND subject<>'deletion' AND resolved_at IS NULL",
          [actor.id, id],
        );
        if (!result.rowCount) throw new AccountAccessError(409, "REQUEST_CHANGED");
      });
    },
  };
}
export function getSupportRequests() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createSupportRequests(auth, pool) : null;
}
