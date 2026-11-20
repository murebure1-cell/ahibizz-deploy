-- Each quote is for one account. There is no default cash price for banners or credits.
CREATE TABLE marketing_order (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES auth_user(id),
  kind text NOT NULL CHECK (kind IN ('credits','banner','featured','nearby')),
  business_id uuid REFERENCES directory_business(id),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','quoted','paid','closed')),
  amount_minor integer CHECK(amount_minor BETWEEN 1 AND 100000000),
  credit_price integer CHECK(credit_price BETWEEN 1 AND 100000),
  instructions text CHECK(length(instructions) BETWEEN 1 AND 600),
  quoted_by text REFERENCES auth_user(id),
  quoted_at timestamptz,
  bank_reference text,
  settled_by text REFERENCES auth_user(id),
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind<>'credits')=(business_id IS NOT NULL)),
  CHECK (kind='credits' OR quantity<=90),
  CHECK (kind<>'credits' OR credit_price IS NULL),
  CHECK ((quoted_at IS NULL AND quoted_by IS NULL AND amount_minor IS NULL AND instructions IS NULL)
      OR (quoted_at IS NOT NULL AND quoted_by IS NOT NULL AND amount_minor IS NOT NULL AND instructions IS NOT NULL)),
  CHECK (status NOT IN ('quoted','paid') OR quoted_at IS NOT NULL),
  CHECK ((status='paid')=(paid_at IS NOT NULL)),
  CHECK (status<>'paid' OR settled_by IS NOT NULL),
  CHECK (kind<>'credits' OR status<>'paid' OR bank_reference IS NOT NULL),
  CHECK (starts_at IS NULL AND ends_at IS NULL OR kind<>'credits' AND status='paid' AND ends_at>starts_at),
  CHECK (kind='credits' OR status<>'paid' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
CREATE UNIQUE INDEX marketing_bank_reference_unique ON marketing_order(upper(trim(bank_reference))) WHERE bank_reference IS NOT NULL;
CREATE UNIQUE INDEX marketing_open_credits_unique ON marketing_order(account_id) WHERE kind='credits' AND status IN ('requested','quoted');
CREATE UNIQUE INDEX marketing_open_ad_unique ON marketing_order(business_id,kind) WHERE kind<>'credits' AND status IN ('requested','quoted');
CREATE INDEX marketing_account_orders ON marketing_order(account_id,created_at DESC,id);
CREATE INDEX marketing_actionable_orders ON marketing_order(status,created_at,id);
CREATE INDEX marketing_public_ads ON marketing_order(kind,business_id,ends_at,starts_at) WHERE kind<>'credits' AND status='paid';

-- A suspended owner, archived listing or ownership change immediately hides its ad.
-- Closing the old placement also prevents it reappearing after transfer back or republication.
CREATE FUNCTION close_marketing_on_listing_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'published' OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    UPDATE marketing_order SET status='closed' WHERE business_id=NEW.id AND status IN ('requested','quoted');
    UPDATE marketing_order SET revoked_at=clock_timestamp()
      WHERE business_id=NEW.id AND kind<>'credits' AND status='paid' AND revoked_at IS NULL AND ends_at>clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER marketing_listing_change AFTER UPDATE OF status,owner_user_id ON directory_business
  FOR EACH ROW EXECUTE FUNCTION close_marketing_on_listing_change();

-- A bank transfer entered in either sales workflow can only fund a single order.
CREATE TABLE marketing_bank_receipt_claim(reference text PRIMARY KEY);
INSERT INTO marketing_bank_receipt_claim(reference)
  SELECT DISTINCT upper(btrim(external_reference)) FROM billing_receipt WHERE source='bank';
CREATE FUNCTION claim_marketing_bank_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='billing_receipt' THEN
    IF NEW.source='bank' THEN
      INSERT INTO marketing_bank_receipt_claim VALUES (upper(btrim(NEW.external_reference)));
    END IF;
  ELSIF NEW.bank_reference IS NOT NULL AND OLD.bank_reference IS NULL THEN
    INSERT INTO marketing_bank_receipt_claim VALUES (upper(btrim(NEW.bank_reference)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER marketing_bank_receipt AFTER UPDATE OF bank_reference ON marketing_order
  FOR EACH ROW EXECUTE FUNCTION claim_marketing_bank_transfer();
CREATE TRIGGER billing_bank_receipt AFTER INSERT ON billing_receipt
  FOR EACH ROW EXECUTE FUNCTION claim_marketing_bank_transfer();
