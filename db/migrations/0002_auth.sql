-- Better Auth 1.7.23 core schema with explicit model names. No accounts or roles are seeded.
CREATE TABLE auth_user (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL DEFAULT false,
    image text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner')),
    approval text NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending', 'approved', 'suspended'))
);
CREATE UNIQUE INDEX auth_user_email_normalized_unique ON auth_user (lower(email));

CREATE TABLE auth_session (
    id text PRIMARY KEY,
    "expiresAt" timestamptz NOT NULL,
    token text NOT NULL UNIQUE,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_idx ON auth_session ("userId");

-- Serialize session admission with owner suspension/approval updates on this user.
-- The application hook gives a readable error; this closes the check/insert race.
CREATE FUNCTION auth_enforce_session_eligibility() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    eligible boolean;
BEGIN
    SELECT ("emailVerified" IS TRUE AND approval = 'approved') INTO eligible
    FROM auth_user WHERE id = NEW."userId" FOR SHARE;
    IF eligible IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'account_not_eligible' USING ERRCODE = '28000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER auth_session_eligibility_before_insert
BEFORE INSERT ON auth_session
FOR EACH ROW EXECUTE FUNCTION auth_enforce_session_eligibility();

CREATE TABLE auth_account (
    id text PRIMARY KEY,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamptz,
    "refreshTokenExpiresAt" timestamptz,
    scope text,
    password text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("providerId", "accountId")
);
CREATE INDEX auth_account_user_idx ON auth_account ("userId");

CREATE TABLE auth_verification (
    id text PRIMARY KEY,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification (identifier);

CREATE TABLE auth_rate_limit (
    id text PRIMARY KEY,
    key text NOT NULL UNIQUE,
    count integer NOT NULL CHECK (count >= 0),
    "lastRequest" bigint NOT NULL CHECK ("lastRequest" >= 0)
);
