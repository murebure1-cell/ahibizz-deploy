-- Private saved-business state. False rows retain the version and prevent stale replays.
CREATE TABLE business_favorite (
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    saved boolean NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, business_id)
);
CREATE INDEX business_favorite_saved_idx ON business_favorite(user_id, business_id) WHERE saved;
CREATE FUNCTION business_favorite_validate_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.version <> 1 THEN
            RAISE EXCEPTION 'favorite_invalid_initial_version' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.user_id <> OLD.user_id OR NEW.business_id <> OLD.business_id
       OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'favorite_invalid_change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER business_favorite_state_guard BEFORE INSERT OR UPDATE ON business_favorite FOR EACH ROW EXECUTE FUNCTION business_favorite_validate_change();
CREATE TABLE business_favorite_command (
    user_id text NOT NULL,
    request_id uuid NOT NULL,
    business_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    result_version integer NOT NULL CHECK (result_version >= 1),
    result_saved boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_id),
    FOREIGN KEY (user_id, business_id) REFERENCES business_favorite(user_id, business_id) ON DELETE RESTRICT
);
