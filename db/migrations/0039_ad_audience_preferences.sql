CREATE TABLE ad_audience_preference (
 account_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
 gender text NOT NULL CHECK(gender IN ('women','men')),
 consented_at timestamptz NOT NULL DEFAULT now()
);
