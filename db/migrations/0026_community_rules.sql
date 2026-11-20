CREATE TABLE community_rules_acceptance (
  account_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  rules_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, rules_version)
);
