import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ApprovalEmailSender } from "./mail";

/** Claim one committed decision. The lease survives process loss and excludes concurrent senders. */
export async function deliverNextApprovalEmail(
  pool: Pool,
  baseURL: string,
  send: ApprovalEmailSender,
) {
  const claimId = randomUUID();
  const { rows } = await pool.query<{ user_id: string; decision_id: string; email: string }>(
    `WITH candidate AS (
       SELECT n.user_id, u.email
       FROM account_approval_email n JOIN auth_user u ON u.id = n.user_id
       WHERE n.accepted_at IS NULL AND n.failures < 12 AND n.next_attempt_at <= now()
         AND u."emailVerified" AND u.approval = 'approved'
       ORDER BY n.next_attempt_at, n.user_id
       LIMIT 1 FOR UPDATE OF n SKIP LOCKED
     )
     UPDATE account_approval_email n
     SET claim_id = $1, next_attempt_at = now() + interval '5 minutes'
     FROM candidate WHERE candidate.user_id = n.user_id
     RETURNING n.user_id, n.decision_id, candidate.email`,
    [claimId],
  );
  const item = rows[0];
  if (!item) return "idle";
  const key = [item.user_id, item.decision_id, claimId];
  try {
    await send({
      kind: "account-approved",
      decisionId: item.decision_id,
      to: item.email,
      url: new URL("/prijava", baseURL).href,
    });
  } catch {
    await pool.query(
      `UPDATE account_approval_email SET failures = failures + 1, claim_id = NULL,
           next_attempt_at = now() + interval '1 minute' * LEAST(360, power(2, failures))
       WHERE user_id = $1 AND decision_id = $2 AND claim_id = $3`,
      key,
    );
    return "failed";
  }
  await pool.query(
    `UPDATE account_approval_email SET accepted_at = now(), claim_id = NULL
     WHERE user_id = $1 AND decision_id = $2 AND claim_id = $3`,
    key,
  );
  return "accepted";
}
