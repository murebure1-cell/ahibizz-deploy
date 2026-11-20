CREATE TABLE ad_rate_card (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  minimum_minor integer NOT NULL DEFAULT 50000 CHECK (minimum_minor BETWEEN 0 AND 100000000),
  volume_percent integer[] NOT NULL DEFAULT ARRAY[20,25,35,40,45] CHECK (cardinality(volume_percent)=5 AND array_position(volume_percent,NULL) IS NULL AND 0 <= ALL(volume_percent) AND 99 >= ALL(volume_percent)),
  advance_percent integer NOT NULL DEFAULT 5 CHECK (advance_percent BETWEEN 0 AND 99),
  welcome_percent integer NOT NULL DEFAULT 20 CHECK (welcome_percent BETWEEN 0 AND 99),
  contact_phone text CHECK(contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  updated_by text REFERENCES auth_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ad_rate_card (singleton) VALUES (true);

CREATE TABLE ad_placement_rate (
  format_id text NOT NULL,
  page text NOT NULL CHECK (page IN ('home','category','search','listing')),
  device text NOT NULL CHECK (device IN ('mobile','desktop')),
  available boolean NOT NULL,
  cpm_minor integer CHECK(cpm_minor BETWEEN 1 AND 1000000),
  PRIMARY KEY (format_id,page,device)
);
