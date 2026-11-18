ALTER TABLE auth_user
    ADD COLUMN profile_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN verification_version integer NOT NULL DEFAULT 0 CHECK (verification_version >= 0);

ALTER TABLE directory_business
    ADD COLUMN verification_version integer NOT NULL DEFAULT 0 CHECK (verification_version >= 0);

CREATE TABLE profile_verification_decision (
    kind text NOT NULL CHECK (kind IN ('person', 'business')),
    target_id text NOT NULL,
    result_version integer NOT NULL CHECK (result_version > 0),
    verified boolean NOT NULL,
    actor_user_id text REFERENCES auth_user(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (kind, target_id, result_version),
    CHECK (actor_user_id IS NOT NULL OR verified = false)
);

CREATE FUNCTION verification_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'verification_history_is_immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER verification_decision_immutable BEFORE UPDATE OR DELETE ON profile_verification_decision
FOR EACH ROW EXECUTE FUNCTION verification_decision_immutable();

-- A decision made on the former identity must not mark the new identity.
-- Bump the CAS token even when the former identity did not have a badge.
CREATE FUNCTION verification_person_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.profile_verified := false;
    NEW.verification_version := OLD.verification_version + 1;
    IF OLD.profile_verified THEN
        INSERT INTO profile_verification_decision(kind,target_id,result_version,verified,reason)
        VALUES ('person',OLD.id,NEW.verification_version,false,'Promjena identiteta naloga.');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER verification_person_changed BEFORE UPDATE OF name,email,"emailVerified" ON auth_user
FOR EACH ROW WHEN (NEW.name IS DISTINCT FROM OLD.name OR lower(NEW.email) IS DISTINCT FROM lower(OLD.email)
    OR (OLD."emailVerified" AND NOT NEW."emailVerified"))
EXECUTE FUNCTION verification_person_changed();

CREATE FUNCTION verification_business_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.is_verified := false;
    NEW.verification_version := OLD.verification_version + 1;
    IF OLD.is_verified THEN
        INSERT INTO profile_verification_decision(kind,target_id,result_version,verified,reason)
        VALUES ('business',OLD.id::text,NEW.verification_version,false,'Promjena naziva ili vlasnika djelatnosti.');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER verification_business_changed BEFORE UPDATE OF title,owner_user_id ON directory_business
FOR EACH ROW WHEN (NEW.title IS DISTINCT FROM OLD.title OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id)
EXECUTE FUNCTION verification_business_changed();
