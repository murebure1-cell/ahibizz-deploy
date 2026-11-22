-- Immutable bank instructions point to the existing quote and existing credit ledger.
CREATE TABLE ahi_wallet_bank_topup (
  id uuid PRIMARY KEY REFERENCES ahi_wallet_topup_request(id),
  order_id uuid NOT NULL UNIQUE REFERENCES marketing_order(id),
  account_id text NOT NULL REFERENCES auth_user(id),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),
  original_bam_minor integer NOT NULL CHECK(original_bam_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK(currency IN ('BAM','EUR')),
  payment_reference text NOT NULL UNIQUE CHECK(payment_reference ~ '^AHI-[A-F0-9]{32}$'),
  receiver jsonb NOT NULL CHECK(jsonb_typeof(receiver)='object'),
  config_fingerprint text NOT NULL CHECK(config_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by text REFERENCES auth_user(id),
  approved_at timestamptz,
  CHECK((approved_by IS NULL)=(approved_at IS NULL))
);
CREATE INDEX ahi_wallet_bank_topup_account ON ahi_wallet_bank_topup(account_id,created_at DESC,id);

CREATE FUNCTION guard_bank_topup_instructions() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF EXISTS (SELECT 1 FROM paypal_checkout_order p WHERE p.quote_id=sale.id AND (
    p.status IN ('captured','review','partially_refunded')
    OR (p.status IN ('refunded','reversed') AND (sale.online_checkout_id=p.id OR p.capture_id IS NULL
      OR p.captured_at IS NULL OR p.refund_total_unknown OR p.refunded_minor<>p.amount_minor))
    OR (p.status IN ('created','provider_created') AND GREATEST(p.expires_at,p.capture_lease_until)>clock_timestamp())
  )) THEN RAISE EXCEPTION 'bank_topup_online_payment_pending' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_bank_topup_instructions BEFORE INSERT OR UPDATE OR DELETE ON ahi_wallet_bank_topup
  FOR EACH ROW EXECUTE FUNCTION guard_bank_topup_instructions();

CREATE FUNCTION guard_bank_topup_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ahi_wallet_bank_topup WHERE order_id=NEW.id) THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.online_checkout_id IS NOT NULL OR NEW.wallet_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'bank_topup_order_immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status='paid' AND EXISTS (SELECT 1 FROM ahi_wallet_bank_topup
      WHERE order_id=NEW.id AND (approved_at IS NULL OR approved_by IS DISTINCT FROM NEW.settled_by)) THEN
      RAISE EXCEPTION 'bank_topup_review_required' USING ERRCODE='23514';
    END IF;
    IF OLD.status='paid' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.settled_by IS DISTINCT FROM OLD.settled_by) THEN
      RAISE EXCEPTION 'bank_topup_terminal' USING ERRCODE='23514';
    END IF;
    IF OLD.status='closed' AND NEW.status NOT IN ('closed','paid') THEN
      RAISE EXCEPTION 'bank_topup_terminal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_bank_topup_settlement BEFORE UPDATE ON marketing_order
  FOR EACH ROW EXECUTE FUNCTION guard_bank_topup_settlement();

CREATE FUNCTION check_bank_topup_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.approved_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM marketing_order WHERE id=NEW.order_id AND status='paid' AND bank_reference IS NOT NULL
      AND online_checkout_id IS NULL AND settled_by=NEW.approved_by
  ) THEN RAISE EXCEPTION 'bank_topup_settlement_missing' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_bank_topup_approval AFTER INSERT OR UPDATE ON ahi_wallet_bank_topup
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_bank_topup_approval();

CREATE FUNCTION guard_bank_quote_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote_id IS NOT NULL THEN
    PERFORM 1 FROM marketing_order WHERE id=NEW.quote_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM ahi_wallet_bank_topup WHERE order_id=NEW.quote_id) THEN
      RAISE EXCEPTION 'bank_topup_quote_locked' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_bank_quote_checkout BEFORE INSERT OR UPDATE OF quote_id ON paypal_checkout_order
  FOR EACH ROW EXECUTE FUNCTION guard_bank_quote_checkout();
