-- Immutable quoted BAM prices are converted to EUR by the server. Existing products keep their original checks.
ALTER TABLE paypal_checkout_order
  ADD COLUMN quote_id uuid REFERENCES marketing_order(id) ON DELETE RESTRICT,
  DROP CONSTRAINT paypal_checkout_order_kind_check,
  DROP CONSTRAINT paypal_checkout_order_check1,
  DROP CONSTRAINT paypal_checkout_order_amount_minor_check,
  ADD CONSTRAINT checkout_product_proof CHECK (
    (kind='promotion' AND quote_id IS NULL AND business_id IS NOT NULL AND category_id IS NOT NULL
       AND business_title IS NOT NULL AND original_bam_minor IS NOT NULL AND original_bam_minor=1000) OR
    (kind='support' AND quote_id IS NULL AND business_id IS NULL AND category_id IS NULL
       AND business_title IS NULL AND original_bam_minor IS NULL) OR
    (kind='quote' AND quote_id IS NOT NULL AND business_id IS NULL AND category_id IS NULL
       AND business_title IS NOT NULL AND original_bam_minor IS NOT NULL AND original_bam_minor BETWEEN 1 AND 100000000
       AND amount_minor=round(original_bam_minor::numeric*100000/195583))),
  ADD CONSTRAINT checkout_amount_range CHECK (amount_minor BETWEEN 1 AND
    CASE WHEN kind='quote' THEN 51129188 ELSE 1000000 END);
CREATE INDEX checkout_by_quote ON paypal_checkout_order(quote_id,environment,created_at DESC) WHERE quote_id IS NOT NULL;
ALTER TABLE marketing_order
  ADD COLUMN online_checkout_id uuid UNIQUE REFERENCES paypal_checkout_order(id) ON DELETE RESTRICT,
  DROP CONSTRAINT marketing_order_check7,
  ADD CONSTRAINT marketing_distinct_payment CHECK (online_checkout_id IS NULL OR (bank_reference IS NULL AND status='paid')),
  ADD CONSTRAINT credits_need_receipt CHECK (kind<>'credits' OR status<>'paid' OR bank_reference IS NOT NULL OR online_checkout_id IS NOT NULL);

CREATE FUNCTION protect_checkout_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN
    RAISE EXCEPTION 'checkout_quote_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_checkout_quote BEFORE UPDATE OF quote_id ON paypal_checkout_order
FOR EACH ROW EXECUTE FUNCTION protect_checkout_quote();

-- A chargeback or correction invalidates the purchased right even when it arrives via webhook.
CREATE FUNCTION revoke_online_marketing_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote_id IS NOT NULL AND (NEW.status <> 'captured' OR NEW.refunded_minor>0 OR NEW.refund_total_unknown) THEN
    UPDATE marketing_order SET revoked_at=COALESCE(revoked_at,clock_timestamp())
      WHERE id=NEW.quote_id AND online_checkout_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER revoke_online_marketing_purchase AFTER UPDATE OF status,refunded_minor,refund_total_unknown ON paypal_checkout_order
FOR EACH ROW EXECUTE FUNCTION revoke_online_marketing_purchase();
