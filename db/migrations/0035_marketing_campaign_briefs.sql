ALTER TABLE marketing_order ADD COLUMN campaign_key text
  CHECK (campaign_key IS NULL OR (kind='banner' AND length(campaign_key) BETWEEN 4 AND 100));
ALTER TABLE marketing_order ADD COLUMN campaign_benefit text
  CHECK (campaign_benefit IS NULL OR (campaign_key IS NOT NULL AND campaign_benefit IN ('advance','welcome')));
CREATE UNIQUE INDEX marketing_campaign_welcome_once ON marketing_order(account_id)
  WHERE campaign_benefit='welcome' AND status IN ('paid','quoted');
DROP INDEX marketing_open_ad_unique;
CREATE UNIQUE INDEX marketing_open_ad_unique ON marketing_order(business_id,kind,(COALESCE(campaign_key,'')))
  WHERE kind<>'credits' AND status IN ('requested','quoted');

CREATE TABLE marketing_campaign_brief (
  order_id uuid PRIMARY KEY REFERENCES marketing_order(id),
  device text NOT NULL CHECK (device IN ('mobile','desktop')),
  page text NOT NULL CHECK (page IN ('home','search','category','listing')),
  format text NOT NULL CHECK (length(format) BETWEEN 2 AND 40),
  impression_goal integer NOT NULL CHECK (impression_goal BETWEEN 1000 AND 10000000),
  budget_minor integer CHECK (budget_minor BETWEEN 1 AND 100000000),
  starts_on date,
  city text CHECK (length(city) BETWEEN 1 AND 100),
  category_id uuid REFERENCES directory_category(id),
  keyword text CHECK (keyword IS NULL OR (page='search' AND length(keyword) BETWEEN 1 AND 80)),
  target_gender text CHECK (page='listing' AND format<>'loan_calculator' AND target_gender IN ('women','men') OR target_gender IS NULL),
  min_price_minor integer CHECK ((page='listing' AND min_price_minor BETWEEN 0 AND 100000000) OR min_price_minor IS NULL),
  max_price_minor integer CHECK ((page='listing' AND max_price_minor BETWEEN 0 AND 100000000) OR max_price_minor IS NULL),
  CHECK (min_price_minor<=max_price_minor),
  creative_kind text CHECK (creative_kind IN ('logo','cover','gallery')),
  creative_slot integer,
  creative_version integer,
  destination_url text CHECK (length(destination_url)<=2048 AND destination_url ~ '^https://'),
  targeting_note text CHECK (length(targeting_note) BETWEEN 1 AND 400),
  replaced_targeting_note text CHECK (replaced_targeting_note IS NULL OR (length(replaced_targeting_note) BETWEEN 1 AND 400 AND targeting_note IS NULL)),
  rate_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rate_snapshot)='object'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CHECK (category_id IS NULL OR page<>'home'),
  CHECK ((creative_kind IS NULL AND creative_slot IS NULL AND creative_version IS NULL) OR
    (creative_kind IS NOT NULL AND creative_slot IS NOT NULL AND creative_version IS NOT NULL AND creative_version>0
      AND ((creative_kind IN ('logo','cover') AND creative_slot=0) OR (creative_kind='gallery' AND creative_slot BETWEEN 1 AND 8))))
);
CREATE INDEX marketing_campaign_slot ON marketing_campaign_brief(page,device,format);

-- All settlement methods share the same paid window, including a delayed provider notification.
CREATE FUNCTION apply_campaign_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE planned date;
BEGIN
  SELECT starts_on INTO planned FROM marketing_campaign_brief WHERE order_id=NEW.id;
  IF planned IS NOT NULL THEN
    NEW.starts_at := GREATEST(NEW.starts_at, planned::timestamp AT TIME ZONE 'UTC');
    NEW.ends_at := NEW.starts_at + NEW.quantity * interval '1 day';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER apply_campaign_schedule BEFORE UPDATE OF status ON marketing_order
  FOR EACH ROW WHEN (NEW.kind='banner' AND NEW.campaign_key IS NOT NULL AND OLD.status<>'paid' AND NEW.status='paid')
  EXECUTE FUNCTION apply_campaign_schedule();
