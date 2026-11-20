CREATE TABLE ad_measurement_consent (
  account_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
  region text CHECK (region IN ('fbih','rs','brcko','abroad')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad_audience_navigation (
  account_id text NOT NULL REFERENCES ad_measurement_consent(account_id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  starts_visit boolean NOT NULL,
  PRIMARY KEY (account_id, event_id)
);
CREATE INDEX ad_audience_navigation_recent ON ad_audience_navigation(account_id, seen_at DESC);
CREATE INDEX ad_audience_navigation_window ON ad_audience_navigation(seen_at);
