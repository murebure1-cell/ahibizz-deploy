-- Owner decision 2026-11-24: PayPal is removed from AhiBizz completely, including its archived
-- provider tables. Pre-release backup 2026-11-24_16-45-28 holds the dropped rows for 30 days.
-- Not changed: accounting receipts (billing_receipt), the 20% development ledger, and other archived
-- orders and contracts, including their historical 'paypal' source and payment_method values.
-- The database code below is rewritten to behave as it does when no PayPal order exists.

-- Archived credit view: a reversal is now the whole order. The partial-refund amount lived only in
-- paypal_checkout_order. The wallet module is no longer in the app; the view stays for history.
CREATE OR REPLACE VIEW ahi_credit_movements AS
  SELECT recipient_user_id AS account_id, 'booking:' || entry_id AS id, 'booking' AS kind,
    amount::bigint*100 AS amount_minor, created_at FROM booking_completion_credit
  UNION ALL
  SELECT o.account_id, 'topup:' || o.id, 'topup', o.quantity::bigint*100, o.paid_at
    FROM marketing_order o WHERE o.kind='credits' AND o.status='paid'
  UNION ALL
  SELECT o.account_id, 'reversal:' || o.id, 'reversal', -(o.quantity::bigint*100), o.revoked_at
    FROM marketing_order o
    WHERE o.kind='credits' AND o.status='paid' AND o.revoked_at IS NOT NULL
  UNION ALL
  SELECT o.account_id, 'legacy:' || o.id, o.kind, -o.credit_price::bigint*100, o.paid_at
    FROM marketing_order o WHERE o.kind<>'credits' AND o.status='paid' AND o.bank_reference IS NULL
      AND o.online_checkout_id IS NULL AND o.wallet_payment_id IS NULL AND o.credit_price IS NOT NULL
  UNION ALL
  SELECT d.account_id, 'debit:' || d.purchase_id, COALESCE(o.kind,d.kind), -d.credit_minor, d.created_at
    FROM ahi_wallet_debit d LEFT JOIN marketing_order o ON o.wallet_payment_id=d.purchase_id;

-- A production receipt could only be linked to a paid PayPal capture. With no PayPal orders left,
-- no new link can be proven, so new links stay refused exactly as before.
CREATE OR REPLACE FUNCTION guard_production_receipt_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.production_order_id IS NOT NULL AND NEW.production_order_id IS DISTINCT FROM OLD.production_order_id THEN
    RAISE EXCEPTION 'production_receipt_link_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.production_order_id IS NULL AND NEW.production_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'production_receipt_identity_mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Same checks as migration 0052 without the pending-PayPal-payment lookup.
CREATE OR REPLACE FUNCTION guard_bank_topup_instructions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale marketing_order%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'bank_topup_history_immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'bank_topup_review_required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'approved_by'-'approved_at') IS DISTINCT FROM (to_jsonb(OLD)-'approved_by'-'approved_at')
       OR OLD.approved_at IS NOT NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'bank_topup_history_immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO sale FROM marketing_order WHERE id=NEW.order_id FOR UPDATE;
  IF sale.id IS NULL OR sale.kind<>'credits' OR sale.account_id<>NEW.account_id
     OR (sale.status<>'quoted' AND NOT (TG_OP='UPDATE' AND sale.status='closed'))
     OR sale.quantity<>NEW.quantity OR sale.amount_minor<>NEW.original_bam_minor OR sale.online_checkout_id IS NOT NULL
     OR sale.bank_reference IS NOT NULL OR
     NEW.amount_minor<>(CASE WHEN NEW.currency='BAM' THEN sale.amount_minor ELSE (sale.amount_minor::bigint*100000+97791)/195583 END) THEN
    RAISE EXCEPTION 'bank_topup_order_mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- marketing_order.online_checkout_id keeps its old values as plain history; only the link goes.
DO $$
DECLARE link record;
BEGIN
  FOR link IN
    SELECT c.conrelid::regclass AS owner, c.conname
      FROM pg_constraint c
     WHERE c.contype='f'
       AND c.confrelid IN (SELECT oid FROM pg_class WHERE relkind='r' AND relname LIKE 'paypal\_%')
       AND c.conrelid NOT IN (SELECT oid FROM pg_class WHERE relkind='r' AND relname LIKE 'paypal\_%')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', link.owner, link.conname);
  END LOOP;
END $$;

-- Children first. Triggers and indexes on these tables go with them.
DROP TABLE paypal_refund_command;
DROP TABLE paypal_webhook_event;
DROP TABLE paypal_checkout_event;
DROP TABLE paypal_promotion_entitlement;
DROP TABLE paypal_checkout_order;

DROP FUNCTION guard_bank_quote_checkout();
DROP FUNCTION protect_checkout_quote();
DROP FUNCTION revoke_online_marketing_purchase();
DROP FUNCTION paypal_checkout_identity_guard();
DROP FUNCTION IF EXISTS paypal_revoke_business_rights();
DROP FUNCTION IF EXISTS paypal_revoke_user_rights();
