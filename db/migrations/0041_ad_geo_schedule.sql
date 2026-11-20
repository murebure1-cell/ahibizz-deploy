-- Countries describe the published page. A regional campaign is an explicit set of city names.
ALTER TABLE marketing_campaign_brief
  ADD COLUMN country_code text CHECK (country_code IS NULL OR (page='listing' AND country_code ~ '^[A-Z]{2}$')),
  ADD COLUMN target_cities text[] NOT NULL DEFAULT '{}' CHECK (
    cardinality(target_cities)<=12 AND array_position(target_cities,NULL) IS NULL
    AND (cardinality(target_cities)=0 OR city IS NULL)),
  ADD COLUMN local_start_minute smallint CHECK (local_start_minute BETWEEN 0 AND 1439),
  ADD COLUMN local_end_minute smallint CHECK (local_end_minute BETWEEN 0 AND 1439),
  ADD COLUMN local_time_zone text,
  ADD CHECK ((local_start_minute IS NULL AND local_end_minute IS NULL AND local_time_zone IS NULL) OR
    (local_start_minute IS NOT NULL AND local_end_minute IS NOT NULL AND local_start_minute<>local_end_minute
     AND local_time_zone IS NOT NULL AND length(local_time_zone) BETWEEN 1 AND 80));

CREATE FUNCTION campaign_window_open(stamp timestamptz, from_minute integer, until_minute integer, zone text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN from_minute IS NULL THEN true
          WHEN from_minute<until_minute THEN minute>=from_minute AND minute<until_minute
          ELSE minute>=from_minute OR minute<until_minute END
  FROM (SELECT extract(hour FROM local_at)::integer*60+extract(minute FROM local_at)::integer AS minute
    FROM (SELECT stamp AT TIME ZONE zone AS local_at) t) local_clock
$$;

-- The delivery period and hours follow the same local clock, including DST changes.
CREATE OR REPLACE FUNCTION apply_campaign_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE planned date; zone text;
BEGIN
  SELECT starts_on,local_time_zone INTO planned,zone FROM marketing_campaign_brief WHERE order_id=NEW.id;
  IF planned IS NOT NULL THEN
    NEW.starts_at := GREATEST(NEW.starts_at,planned::timestamp AT TIME ZONE COALESCE(zone,'UTC'));
  END IF;
  IF zone IS NOT NULL THEN
    NEW.ends_at := ((NEW.starts_at AT TIME ZONE zone) + NEW.quantity * interval '1 day') AT TIME ZONE zone;
  ELSIF planned IS NOT NULL THEN
    NEW.ends_at := NEW.starts_at + NEW.quantity * interval '1 day';
  END IF;
  RETURN NEW;
END $$;

-- Previously issued view tokens may survive a daily window boundary.
ALTER FUNCTION record_marketing_ad(uuid,uuid,text,boolean,text,text,text) RENAME TO record_marketing_ad_in_window;
CREATE FUNCTION record_marketing_ad(render_id uuid, campaign uuid, screen text, is_click boolean,
    tab_key text DEFAULT NULL, network_key text DEFAULT NULL, os_family text DEFAULT 'other')
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketing_campaign_brief brief WHERE brief.order_id=campaign
    AND NOT campaign_window_open(clock_timestamp(),brief.local_start_minute,brief.local_end_minute,brief.local_time_zone)) THEN
    RETURN false;
  END IF;
  RETURN record_marketing_ad_in_window(render_id,campaign,screen,is_click,tab_key,network_key,os_family);
END $$;

