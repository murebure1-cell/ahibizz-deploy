CREATE TABLE directory_saved_search (
  account_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  filters text NOT NULL CHECK (length(filters) BETWEEN 2 AND 3200 AND left(filters, 1) = '?'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, filters)
);
