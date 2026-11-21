CREATE TABLE business_reel (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE CASCADE,
  submitted_by text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 600),
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','pending','published','rejected','withdrawn')),
  source_size integer NOT NULL CHECK (source_size BETWEEN 32 AND 25165824),
  duration_ms integer CHECK (duration_ms BETWEEN 1000 AND 90000),
  has_poster boolean NOT NULL,
  review_reason text CHECK (char_length(btrim(review_reason)) BETWEEN 1 AND 600),
  reviewed_by text REFERENCES auth_user(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status NOT IN ('pending','published') OR duration_ms IS NOT NULL),
  CHECK (status <> 'rejected' OR (review_reason IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (status <> 'published' OR (reviewed_at IS NOT NULL AND published_at IS NOT NULL))
);

CREATE INDEX business_reel_feed ON business_reel (published_at DESC, id DESC)
  WHERE status='published';
CREATE INDEX business_reel_listing ON business_reel (business_id, published_at DESC, id DESC)
  WHERE status='published';
CREATE INDEX business_reel_managed ON business_reel (submitted_by, created_at DESC, id DESC);
CREATE INDEX business_reel_queue ON business_reel (created_at, id) WHERE status='pending';
CREATE INDEX business_reel_abandoned ON business_reel (created_at, id) WHERE status='uploading';

CREATE TABLE business_reel_part (
  reel_id uuid NOT NULL REFERENCES business_reel(id) ON DELETE CASCADE,
  part_index integer NOT NULL CHECK (part_index BETWEEN -1 AND 31),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 786432),
  PRIMARY KEY (reel_id, part_index)
);
ALTER TABLE business_reel_part ALTER COLUMN bytes SET STORAGE EXTERNAL;
