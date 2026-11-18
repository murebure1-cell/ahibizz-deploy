-- Start with an empty queue. Installing this change must not email existing members.
CREATE TABLE account_approval_email (
    user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
    decision_id uuid NOT NULL REFERENCES auth_account_audit(id),
    failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 12),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claim_id uuid,
    accepted_at timestamptz
);
CREATE INDEX account_approval_email_due_idx ON account_approval_email(next_attempt_at)
    WHERE accepted_at IS NULL AND failures < 12;
