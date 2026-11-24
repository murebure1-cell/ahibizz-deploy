-- A published Reel is shown for at most 24 hours. Afterwards it becomes 'expired' and its video and
-- poster bytes are deleted by the server sweep. A moderator can take down a published Reel ('removed',
-- with a reason). Public reads already hide a Reel after 24 hours even before the sweep runs.
ALTER TABLE business_reel DROP CONSTRAINT IF EXISTS business_reel_status_check;
ALTER TABLE business_reel ADD CONSTRAINT business_reel_status_check CHECK (
  status IN ('uploading','pending','published','rejected','withdrawn','expired','removed')
);

ALTER TABLE business_reel ADD CONSTRAINT reel_removed_review CHECK (
  status <> 'removed' OR (review_reason IS NOT NULL AND reviewed_at IS NOT NULL)
);
ALTER TABLE business_reel ADD CONSTRAINT reel_expired_publication CHECK (
  status <> 'expired' OR published_at IS NOT NULL
);

ALTER TABLE business_reel DROP CONSTRAINT IF EXISTS reel_wallet_identity;
ALTER TABLE business_reel ADD CONSTRAINT reel_wallet_identity CHECK (
  wallet_payment_id IS NULL OR (
    wallet_payment_id=id AND price_minor IS NOT NULL AND published_at IS NOT NULL AND
    status IN ('published','withdrawn','expired','removed')
  )
);

CREATE INDEX business_reel_expiry ON business_reel (published_at, id) WHERE status='published';
