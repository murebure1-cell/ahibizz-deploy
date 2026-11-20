CREATE TABLE marketing_ad_asset (
 order_id uuid PRIMARY KEY REFERENCES marketing_order(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','image/gif','video/mp4','text/html')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 1000000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
