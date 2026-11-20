-- Production is one separately quoted service; it has neither placement days nor a credit price.
ALTER TABLE marketing_order
  ADD COLUMN production_receipt_conflict boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT marketing_order_kind_check,
  DROP CONSTRAINT marketing_order_check8,
  DROP CONSTRAINT marketing_order_check9,
  ADD CONSTRAINT marketing_product_kind CHECK (kind IN ('credits','banner','featured','nearby','photo','video','photo_video')),
  ADD CONSTRAINT production_single_service CHECK (
    kind NOT IN ('photo','video','photo_video') OR (quantity=1 AND credit_price IS NULL)),
  ADD CONSTRAINT marketing_placement_period CHECK (
    CASE WHEN kind IN ('banner','featured','nearby') AND status='paid'
      THEN starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at>starts_at
      ELSE starts_at IS NULL AND ends_at IS NULL END),
  ADD CONSTRAINT production_paid_reference CHECK (
    kind NOT IN ('photo','video','photo_video') OR status<>'paid' OR bank_reference IS NOT NULL OR online_checkout_id IS NOT NULL);

ALTER TABLE billing_receipt ADD COLUMN production_order_id uuid UNIQUE REFERENCES marketing_order(id) ON DELETE RESTRICT,
  ADD CONSTRAINT production_receipt_kind CHECK (production_order_id IS NULL OR (kind='photo_video' AND source IN ('bank','paypal')));

CREATE FUNCTION guard_production_receipt_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.production_order_id IS NOT NULL AND NEW.production_order_id IS DISTINCT FROM OLD.production_order_id THEN
    RAISE EXCEPTION 'production_receipt_link_immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.production_order_id IS NULL AND NEW.production_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM marketing_order o JOIN paypal_checkout_order p ON p.id=o.online_checkout_id
    WHERE o.id=NEW.production_order_id AND o.status='paid' AND o.kind IN ('photo','video','photo_video')
      AND p.environment='live' AND p.capture_id=NEW.external_reference AND NEW.source='paypal'
      AND o.amount_minor=NEW.gross_minor AND o.business_id=NEW.business_id
  ) THEN RAISE EXCEPTION 'production_receipt_identity_mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_production_receipt_link BEFORE UPDATE OF production_order_id ON billing_receipt
  FOR EACH ROW EXECUTE FUNCTION guard_production_receipt_link();

-- A business can arrange its images while drafting its profile. Advertising still requires publication.
CREATE OR REPLACE FUNCTION close_marketing_on_listing_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'published' OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    UPDATE marketing_order SET status='closed' WHERE business_id=NEW.id AND status IN ('requested','quoted')
      AND (kind NOT IN ('photo','video','photo_video') OR NEW.status='archived' OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id);
    UPDATE marketing_order SET revoked_at=clock_timestamp()
      WHERE business_id=NEW.id AND kind IN ('banner','featured','nearby') AND status='paid' AND revoked_at IS NULL AND ends_at>clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

-- The marketing payment claims its bank reference first. Its accounting row describes that same deposit.
CREATE OR REPLACE FUNCTION claim_marketing_bank_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='billing_receipt' THEN
    IF NEW.source='bank' THEN
      IF NEW.production_order_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM marketing_order o JOIN marketing_bank_receipt_claim c ON c.reference=o.bank_reference
        WHERE o.id=NEW.production_order_id AND o.kind IN ('photo','video','photo_video') AND o.status='paid'
          AND o.bank_reference=upper(btrim(NEW.external_reference)) AND o.amount_minor=NEW.gross_minor
          AND o.business_id=NEW.business_id
      ) THEN RETURN NEW; END IF;
      INSERT INTO marketing_bank_receipt_claim VALUES (upper(btrim(NEW.external_reference)));
    END IF;
  ELSIF NEW.bank_reference IS NOT NULL AND OLD.bank_reference IS NULL THEN
    INSERT INTO marketing_bank_receipt_claim VALUES (upper(btrim(NEW.bank_reference)));
  END IF;
  RETURN NEW;
END $$;
