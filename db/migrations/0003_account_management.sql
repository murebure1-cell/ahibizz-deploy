CREATE TABLE auth_account_preferences (
    user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
    locale text NOT NULL DEFAULT 'bs' CHECK (locale IN ('bs', 'en', 'de', 'ar', 'tr')),
    appearance text NOT NULL DEFAULT 'system' CHECK (appearance IN ('system', 'light', 'dark')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_account_audit (
    id uuid PRIMARY KEY,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    target_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('approval', 'bootstrap-owner')),
    previous_approval text NOT NULL CHECK (previous_approval IN ('pending', 'approved', 'suspended')),
    next_approval text NOT NULL CHECK (next_approval IN ('approved', 'suspended')),
    previous_role text NOT NULL CHECK (previous_role IN ('member', 'owner')),
    next_role text NOT NULL CHECK (next_role IN ('member', 'owner')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_account_audit_target_idx ON auth_account_audit (target_user_id, created_at);
