ALTER TABLE ahi_wallet_debit
  DROP CONSTRAINT ahi_wallet_debit_kind_check,
  ADD CONSTRAINT ahi_wallet_debit_kind_check CHECK (kind IN ('marketing','promotion','package','reel'));

ALTER TABLE business_reel
  ADD COLUMN price_minor bigint CHECK (price_minor BETWEEN 100 AND 10000000 AND price_minor % 100 = 0),
  ADD COLUMN wallet_payment_id uuid,
  ADD FOREIGN KEY (wallet_payment_id,submitted_by,price_minor)
    REFERENCES ahi_wallet_debit(purchase_id,account_id,credit_minor),
  ADD CONSTRAINT reel_wallet_identity CHECK (
    wallet_payment_id IS NULL OR (
      wallet_payment_id=id AND price_minor IS NOT NULL AND published_at IS NOT NULL AND
      status IN ('published','withdrawn')
    )
  ),
  ADD CONSTRAINT reel_priced_publication CHECK (
    price_minor IS NULL OR status <> 'published' OR wallet_payment_id IS NOT NULL
  );
