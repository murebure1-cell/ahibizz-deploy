-- Production uses the same atomic wallet debit as other AhiBizz services.
ALTER TABLE marketing_order
  DROP CONSTRAINT marketing_credit_products,
  ADD CONSTRAINT marketing_credit_products CHECK (wallet_price_minor IS NULL OR kind<>'credits'),
  DROP CONSTRAINT production_paid_reference,
  ADD CONSTRAINT production_paid_reference CHECK (
    kind NOT IN ('photo','video','photo_video') OR status<>'paid'
      OR bank_reference IS NOT NULL OR online_checkout_id IS NOT NULL OR wallet_payment_id IS NOT NULL
  );

-- Preserve the quoted value of outstanding production offers at the current credit rate.
UPDATE marketing_order
SET wallet_price_minor = amount_minor::bigint * 100 /
  COALESCE((SELECT unit_bam_minor FROM ahi_credit_rate ORDER BY revision DESC LIMIT 1), 10)
WHERE kind IN ('photo','video','photo_video') AND status='quoted' AND wallet_price_minor IS NULL;
