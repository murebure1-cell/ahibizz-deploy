-- Counters contain no account, address or search history. Short-lived receipts deduplicate a render.
CREATE TABLE marketing_ad_daily (
  order_id uuid NOT NULL REFERENCES marketing_order(id) ON DELETE CASCADE,
  day date NOT NULL,
  device text NOT NULL CHECK(device IN ('mobile','desktop')),
  platform text NOT NULL DEFAULT 'other' CHECK (platform IN ('android','ios','desktop','other')),
  impressions bigint NOT NULL DEFAULT 0 CHECK(impressions>=0),
  clicks bigint NOT NULL DEFAULT 0 CHECK(clicks>=0),
  PRIMARY KEY (order_id,day,device,platform)
);
CREATE INDEX marketing_ad_daily_day ON marketing_ad_daily(day);
CREATE VIEW marketing_ad_totals AS
  SELECT order_id,sum(impressions)::bigint AS impressions,sum(clicks)::bigint AS clicks
  FROM marketing_ad_daily GROUP BY order_id;

CREATE TABLE marketing_ad_render_receipt (
  token_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES marketing_order(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL,
  repeat_key text,
  rate_key text,
  clicked boolean NOT NULL DEFAULT false
);
CREATE INDEX marketing_ad_receipt_expiry ON marketing_ad_render_receipt(seen_at);
CREATE UNIQUE INDEX marketing_ad_repeat_render ON marketing_ad_render_receipt(order_id,repeat_key)
  WHERE repeat_key IS NOT NULL;
CREATE INDEX marketing_ad_network_rate ON marketing_ad_render_receipt(order_id,rate_key)
  WHERE rate_key IS NOT NULL;

CREATE FUNCTION record_marketing_ad(render_id uuid, campaign uuid, screen text, is_click boolean,
  tab_key text DEFAULT NULL, network_key text DEFAULT NULL, os_family text DEFAULT 'other')
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  goal integer;
  recorded marketing_ad_render_receipt%ROWTYPE;
  stamp timestamptz := clock_timestamp();
  new_view integer := 0;
BEGIN
  IF screen NOT IN ('mobile','desktop') OR screen IS NULL OR os_family IS NULL OR
    os_family NOT IN ('android','ios','desktop','other') THEN RETURN false; END IF;
  -- Serialise with payments, revocations and the last available impression of this campaign.
  SELECT c.impression_goal INTO goal
    FROM marketing_order o JOIN directory_business b ON b.id=o.business_id AND b.owner_user_id=o.account_id
    JOIN auth_user u ON u.id=o.account_id LEFT JOIN marketing_campaign_brief c ON c.order_id=o.id
    WHERE o.id=campaign AND o.kind='banner' AND o.status='paid' AND o.revoked_at IS NULL
      AND o.starts_at<=stamp AND o.ends_at>stamp AND b.status='published' AND package_allows_listing(b)
      AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')
      AND (c.order_id IS NULL OR c.device=screen)
    FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO recorded FROM marketing_ad_render_receipt WHERE token_id=render_id;
  IF NOT FOUND AND tab_key IS NOT NULL THEN
    SELECT * INTO recorded FROM marketing_ad_render_receipt WHERE order_id=campaign AND repeat_key=tab_key;
  END IF;
  IF recorded.token_id IS NOT NULL THEN
    IF recorded.order_id<>campaign OR NOT is_click OR recorded.clicked THEN RETURN false; END IF;
    UPDATE marketing_ad_render_receipt SET clicked=true WHERE token_id=recorded.token_id;
  ELSE
    IF goal IS NOT NULL AND COALESCE((SELECT impressions FROM marketing_ad_totals WHERE order_id=campaign),0)>=goal
      THEN RETURN false; END IF;
    IF network_key IS NOT NULL AND (SELECT count(*) FROM marketing_ad_render_receipt
         WHERE order_id=campaign AND rate_key=network_key)>=60 THEN RETURN false; END IF;
    INSERT INTO marketing_ad_render_receipt(token_id,order_id,seen_at,clicked,repeat_key,rate_key)
      VALUES(render_id,campaign,stamp,is_click,tab_key,network_key);
    new_view := 1;
  END IF;
  INSERT INTO marketing_ad_daily(order_id, day, device, platform, impressions, clicks)
    VALUES(campaign,(stamp AT TIME ZONE 'UTC')::date,screen,os_family,new_view,is_click::integer)
    ON CONFLICT (order_id,day,device,platform) DO UPDATE
    SET impressions=marketing_ad_daily.impressions+EXCLUDED.impressions,
        clicks=marketing_ad_daily.clicks+EXCLUDED.clicks;

  DELETE FROM marketing_ad_render_receipt WHERE token_id IN (
    SELECT token_id FROM marketing_ad_render_receipt WHERE seen_at < stamp - interval '3 hours'
    ORDER BY seen_at LIMIT 32 FOR UPDATE SKIP LOCKED
  );
  RETURN true;
END $$;
