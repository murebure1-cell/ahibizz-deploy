CREATE TABLE wallet_category_promotion (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_user(id),
  business_id uuid NOT NULL REFERENCES directory_business(id),
  category_id uuid NOT NULL REFERENCES directory_category(id),
  credit_minor integer NOT NULL CHECK (credit_minor > 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revoked_at timestamptz,
  CHECK (ends_at = starts_at + interval '7 days'),
  FOREIGN KEY(id,account_id,credit_minor) REFERENCES ahi_wallet_debit(purchase_id,account_id,credit_minor)
);
CREATE INDEX wallet_category_active ON wallet_category_promotion(business_id, ends_at)
  WHERE revoked_at IS NULL;
CREATE INDEX wallet_category_account ON wallet_category_promotion(account_id, starts_at DESC);

CREATE FUNCTION wallet_revoke_category_promotion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'directory_business' THEN
    UPDATE wallet_category_promotion SET revoked_at=now()
      WHERE business_id=NEW.id AND revoked_at IS NULL AND ends_at>now();
  ELSE
    UPDATE wallet_category_promotion SET revoked_at=now()
      WHERE account_id=NEW.id AND revoked_at IS NULL AND ends_at>now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_promotion_listing_change AFTER UPDATE OF owner_user_id,category_id,status ON directory_business
  FOR EACH ROW WHEN (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION wallet_revoke_category_promotion();
CREATE TRIGGER wallet_promotion_user_change AFTER UPDATE OF approval,"emailVerified",role ON auth_user
  FOR EACH ROW WHEN (NEW.approval IS DISTINCT FROM OLD.approval
    OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified" OR NEW.role IS DISTINCT FROM OLD.role)
  EXECUTE FUNCTION wallet_revoke_category_promotion();
