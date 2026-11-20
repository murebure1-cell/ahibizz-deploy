-- The initial service redemption rate is 10 feninga per credit. Later operator overrides are audited.
CREATE TABLE ahi_credit_rate (
  revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  unit_bam_minor integer NOT NULL CHECK (unit_bam_minor BETWEEN 1 AND 100 AND 100 % nullif(unit_bam_minor,0)=0),
  previous_unit_bam_minor integer,
  changed_by text NOT NULL REFERENCES auth_user(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ahi_wallet_debit (
  purchase_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_user(id),
  kind text NOT NULL CHECK (kind IN ('marketing','promotion','package')),
  credit_minor bigint NOT NULL CHECK (credit_minor BETWEEN 1 AND 10000000000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (purchase_id,account_id,credit_minor)
);
CREATE INDEX ahi_wallet_debits_by_account ON ahi_wallet_debit(account_id,created_at DESC);

CREATE TABLE ahi_wallet_topup_request (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_user(id),
  order_id uuid NOT NULL REFERENCES marketing_order(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000)
);

CREATE FUNCTION keep_wallet_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wallet_history_is_append_only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER keep_wallet_debits BEFORE UPDATE OR DELETE ON ahi_wallet_debit
  FOR EACH ROW EXECUTE FUNCTION keep_wallet_history();
CREATE TRIGGER keep_wallet_rates BEFORE UPDATE OR DELETE ON ahi_credit_rate
  FOR EACH ROW EXECUTE FUNCTION keep_wallet_history();
CREATE TRIGGER keep_wallet_requests BEFORE UPDATE OR DELETE ON ahi_wallet_topup_request
  FOR EACH ROW EXECUTE FUNCTION keep_wallet_history();

ALTER TABLE marketing_order
  ADD COLUMN catalogue_topup boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT marketing_order_check3,
  ADD CONSTRAINT marketing_quote_origin CHECK (
     (NOT catalogue_topup AND quoted_at IS NULL AND quoted_by IS NULL AND amount_minor IS NULL AND instructions IS NULL)
     OR (quoted_at IS NOT NULL AND amount_minor IS NOT NULL AND instructions IS NOT NULL AND
         ((NOT catalogue_topup AND quoted_by IS NOT NULL) OR (catalogue_topup AND quoted_by IS NULL AND kind='credits')))),
  ADD COLUMN wallet_price_minor bigint CHECK(wallet_price_minor BETWEEN 1 AND 10000000000),
  ADD COLUMN wallet_payment_id uuid UNIQUE,
  ADD FOREIGN KEY (wallet_payment_id,account_id,wallet_price_minor)
    REFERENCES ahi_wallet_debit(purchase_id,account_id,credit_minor),
  ADD CONSTRAINT marketing_wallet_identity CHECK (wallet_payment_id IS NULL OR
    (wallet_payment_id=id AND wallet_price_minor IS NOT NULL AND status='paid' AND
     bank_reference IS NULL AND online_checkout_id IS NULL)),
  ADD CONSTRAINT marketing_credit_products CHECK (wallet_price_minor IS NULL OR kind IN ('banner','featured','nearby'));
UPDATE marketing_order SET wallet_price_minor=credit_price::bigint*100 WHERE credit_price IS NOT NULL;
UPDATE marketing_order SET wallet_price_minor=amount_minor::bigint*100/10
  WHERE kind IN ('banner','featured','nearby') AND status='quoted' AND wallet_price_minor IS NULL;

-- Use the same account-scoped mutex for spending, top-up fulfillment and provider corrections.
CREATE FUNCTION ahi_wallet_lock(account text) RETURNS void LANGUAGE sql VOLATILE AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('ahi-credit-wallet:' || account, 0));
$$;
CREATE FUNCTION lock_credit_order_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='credits' THEN PERFORM ahi_wallet_lock(NEW.account_id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lock_credit_order_update BEFORE UPDATE OF status,revoked_at ON marketing_order
  FOR EACH ROW EXECUTE FUNCTION lock_credit_order_update();

-- Old rows are read as movements, without issuing their value a second time.
CREATE VIEW ahi_credit_movements AS
  SELECT recipient_user_id AS account_id, 'booking:' || entry_id AS id, 'booking' AS kind,
    amount::bigint*100 AS amount_minor, created_at FROM booking_completion_credit
  UNION ALL
  SELECT o.account_id, 'topup:' || o.id, 'topup', o.quantity::bigint*100, o.paid_at
    FROM marketing_order o WHERE o.kind='credits' AND o.status='paid'
  UNION ALL
  SELECT o.account_id, 'reversal:' || o.id, 'reversal',
    -CASE WHEN p.status='partially_refunded' AND NOT p.refund_total_unknown AND p.refunded_minor>0
      THEN round(o.quantity::numeric*100*least(p.refunded_minor,p.amount_minor)/p.amount_minor)::bigint
      ELSE o.quantity::bigint*100 END, o.revoked_at
    FROM marketing_order o LEFT JOIN paypal_checkout_order p ON p.id=o.online_checkout_id
    WHERE o.kind='credits' AND o.status='paid' AND o.revoked_at IS NOT NULL
  UNION ALL
  SELECT o.account_id, 'legacy:' || o.id, o.kind, -o.credit_price::bigint*100, o.paid_at
    FROM marketing_order o WHERE o.kind<>'credits' AND o.status='paid' AND o.bank_reference IS NULL
      AND o.online_checkout_id IS NULL AND o.wallet_payment_id IS NULL AND o.credit_price IS NOT NULL
  UNION ALL
  SELECT d.account_id, 'debit:' || d.purchase_id, COALESCE(o.kind,d.kind), -d.credit_minor, d.created_at
    FROM ahi_wallet_debit d LEFT JOIN marketing_order o ON o.wallet_payment_id=d.purchase_id;

CREATE FUNCTION ahi_wallet_available_minor(target_account text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT greatest(0,COALESCE(sum(amount_minor),0))::bigint FROM ahi_credit_movements WHERE account_id=target_account;
$$;
