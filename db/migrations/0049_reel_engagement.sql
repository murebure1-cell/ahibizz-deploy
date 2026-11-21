ALTER TABLE business_reel
  ADD COLUMN view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0);

CREATE TABLE business_reel_like (
  reel_id uuid NOT NULL REFERENCES business_reel(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  PRIMARY KEY (reel_id,user_id)
);
CREATE INDEX business_reel_like_user ON business_reel_like(user_id);

CREATE TABLE business_reel_view (
  reel_id uuid NOT NULL REFERENCES business_reel(id) ON DELETE CASCADE,
  day date NOT NULL,
  viewer_key bytea NOT NULL CHECK (octet_length(viewer_key)=32),
  PRIMARY KEY (reel_id,day,viewer_key)
);
