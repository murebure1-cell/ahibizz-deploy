import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

const requestIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function createAccountErasure(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return async function erase(headers: Headers, requestId: unknown, confirmedEmail: unknown) {
    if (
      typeof requestId !== "string" ||
      !requestIdPattern.test(requestId) ||
      typeof confirmedEmail !== "string" ||
      !confirmedEmail.trim() ||
      confirmedEmail.trim().length > 254
    )
      throw new AccountAccessError(400, "INVALID_ERASURE_CONFIRMATION");

    const current = await access.session(headers);
    return accountTransaction(pool, async (client) => {
      const operator = await access.authority(client, current, true);
      const target = (
        await client.query<{ id: string; email: string; role: string }>(
          `SELECT u.id,u.email,u.role FROM support_request r JOIN auth_user u ON u.id=r.actor_id
           WHERE r.id=$1 AND r.subject='deletion' AND r.resolved_at IS NULL
              AND u.erased_at IS NULL
           FOR UPDATE OF u,r`,
          [requestId],
        )
      ).rows[0];
      if (!target) {
        const receipt = await client.query(
          "SELECT 1 FROM account_erasure_receipt WHERE request_id=$1",
          [requestId],
        );
        if (receipt.rowCount) return;
        throw new AccountAccessError(409, "ERASURE_REQUEST_CHANGED");
      }
      if (target.role !== "member" || target.id === operator.id)
        throw new AccountAccessError(403, "ERASURE_PROTECTED_ACCOUNT");
      if (confirmedEmail.trim().toLowerCase() !== target.email.toLowerCase())
        throw new AccountAccessError(400, "INVALID_ERASURE_CONFIRMATION");

      const pending = (
        await client.query<{ listing: boolean; booking: boolean; payment: boolean }>(
          `SELECT
            EXISTS (
              SELECT 1 FROM directory_business WHERE owner_user_id=$1 AND deleted_at IS NULL
            ) AS listing,
            (EXISTS (
              SELECT 1 FROM booking_entry e JOIN directory_business b ON b.id=e.business_id
              WHERE e.status IN ('requested','confirmed') AND e.kind<>'block'
                AND e.ends_at>now() AND (e.customer_user_id=$1 OR b.owner_user_id=$1)
            ) OR EXISTS (
              SELECT 1 FROM rental_booking r JOIN directory_business b ON b.id=r.business_id
              WHERE r.status IN ('requested','confirmed') AND r.kind='customer'
                AND r.ends_at>now() AND (r.customer_id=$1 OR b.owner_user_id=$1)
            ) OR EXISTS (
              SELECT 1 FROM stay_booking s JOIN directory_business b ON b.id=s.business_id
              WHERE s.status IN ('requested','confirmed') AND s.kind='customer'
                AND s.check_out>=(now() AT TIME ZONE s.timezone)::date
                AND (s.customer_id=$1 OR b.owner_user_id=$1)
            )) AS booking,
            (EXISTS (
              SELECT 1 FROM live_package_contract
              WHERE user_id=$1 AND (
                (payment_method='paypal' AND status NOT IN ('CANCELLED','EXPIRED'))
                OR (paid_cycles>0 AND ends_at>now())
              )
            ) OR EXISTS (
              SELECT 1 FROM paypal_checkout_order
              WHERE user_id=$1 AND environment='live' AND (
                 refund_total_unknown OR status='review' OR capture_lease_until>now()
                 OR (status IN ('created','provider_created') AND expires_at>now())
              )
            ) OR EXISTS (
              SELECT 1 FROM ahi_wallet_bank_topup bank JOIN marketing_order sale ON sale.id=bank.order_id
              WHERE bank.account_id=$1 AND sale.status IN ('requested','quoted')
            )) AS payment`,
          [target.id],
        )
      ).rows[0];
      if (pending?.payment) throw new AccountAccessError(409, "ERASURE_PAYMENT_PENDING");
      if (pending?.booking) throw new AccountAccessError(409, "ERASURE_BOOKING_PENDING");
      if (pending?.listing) throw new AccountAccessError(409, "ERASURE_BUSINESS_PENDING");

      await client.query(
        `UPDATE auth_user SET name='Obrisan nalog',email=$2,"emailVerified"=false,
             image=NULL,profile_verified=false,approval='suspended',
             erased_at=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE id=$1`,
        [target.id, `erased-${randomUUID()}@ahibizz.invalid`],
      );
      await client.query("SELECT erase_account_content($1,$2)", [target.id, target.email]);
      await client.query(
        "INSERT INTO account_erasure_receipt(request_id,account_id,processed_by) VALUES($1,$2,$3)",
        [requestId, target.id, operator.id],
      );
    });
  };
}

export function getAccountErasure() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createAccountErasure(auth, pool) : null;
}
