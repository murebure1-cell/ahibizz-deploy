-- The package an account holds decides how many businesses it may keep (docs/PROIZVOD.md).
-- An account without a row holds Basic. Until web billing exists only an administrator writes
-- here, and every change leaves its decision with a reason.
CREATE TABLE account_package (
    user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE RESTRICT,
    package text NOT NULL CHECK (package IN ('basic','startup','business')),
    version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483646),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_package_decision (
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    result_version integer NOT NULL CHECK (result_version >= 1),
    previous_package text NOT NULL CHECK (previous_package IN ('basic','startup','business')),
    package text NOT NULL CHECK (package IN ('basic','startup','business')),
    actor_user_id text REFERENCES auth_user(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    decided_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, result_version),
    CHECK (previous_package <> package)
);
