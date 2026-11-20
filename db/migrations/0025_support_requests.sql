CREATE TABLE support_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (subject IN ('deletion', 'person', 'business', 'review', 'conversation')),
  reference text NOT NULL CHECK (length(reference) <= 128),
  details text NOT NULL CHECK (length(details) <= 800),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text REFERENCES auth_user(id) ON DELETE SET NULL,
  CHECK ((subject = 'deletion' AND reference = '') OR (subject <> 'deletion' AND reference <> ''))
);
CREATE UNIQUE INDEX support_request_open_target ON support_request(actor_id,subject,reference) WHERE resolved_at IS NULL;
CREATE INDEX support_request_open_by_date ON support_request(created_at,id) WHERE resolved_at IS NULL;
CREATE INDEX support_request_actor_time ON support_request(actor_id,created_at);
