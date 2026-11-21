import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { type SupportSubject, supportTarget } from "../lib/support-requests";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

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
        const existing = await client.query(
          "SELECT id FROM support_request WHERE actor_id=$1 AND subject=$2 AND reference=$3 AND (subject='help' OR resolved_at IS NULL)",
          [actor.id, target.subject, target.reference],
        );
        if (existing.rowCount) return;
        if (target.subject !== "deletion") {
          const recent = await client.query(
            "SELECT count(*)::int AS count FROM support_request WHERE actor_id=$1 AND subject<>'deletion' AND created_at > now() - interval '1 day'",
            [actor.id],
          );
          if (recent.rows[0].count >= 10) throw new AccountAccessError(429, "TOO_MANY_REQUESTS");
        }
        await client.query(
          "INSERT INTO support_request(id,actor_id,subject,reference,details) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            actor.id,
            target.subject,
            target.reference,
            target.subject === "deletion" ? "" : details.trim(),
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
