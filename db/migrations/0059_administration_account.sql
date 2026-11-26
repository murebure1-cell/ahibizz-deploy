-- The owner's decision of 2026-11-26: one separate "AhiBizz administracija" account does the
-- administration, and the founder's own account becomes an ordinary personal account with a
-- founder mark. Neither column is ever set by sign-up or by the browser; only the reviewed
-- server actions in src/server/auth/administration.ts write them, each with an audit row.
ALTER TABLE auth_user
    ADD COLUMN account_kind text NOT NULL DEFAULT 'personal'
        CHECK (account_kind IN ('personal', 'administration')),
    ADD COLUMN founder boolean NOT NULL DEFAULT false;
-- One administration account and one founder at most.
CREATE UNIQUE INDEX auth_user_one_administration ON auth_user (account_kind)
    WHERE account_kind = 'administration';
CREATE UNIQUE INDEX auth_user_one_founder ON auth_user (founder) WHERE founder;
-- The founder is a person, never the administration account.
ALTER TABLE auth_user ADD CONSTRAINT auth_user_founder_personal
    CHECK (NOT founder OR account_kind = 'personal');

ALTER TABLE auth_account_audit DROP CONSTRAINT auth_account_audit_action_check;
ALTER TABLE auth_account_audit ADD CONSTRAINT auth_account_audit_action_check
    CHECK (action IN ('approval', 'bootstrap-owner', 'create-administration', 'hand-over-administration'));
