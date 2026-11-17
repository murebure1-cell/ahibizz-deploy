-- Explicit administrator ownership transfer only. No existing ownership is changed.
CREATE TABLE directory_ownership_transfer (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    previous_owner_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    target_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    previous_version integer NOT NULL CHECK (previous_version BETWEEN 1 AND 2147483646),
    result_version integer NOT NULL CHECK (result_version = previous_version + 1),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    note text CHECK (char_length(note) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_user_id, request_id),
    UNIQUE (business_id, result_version),
    CHECK (previous_owner_user_id <> target_user_id)
);

CREATE FUNCTION directory_ownership_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM auth_user WHERE id=NEW.actor_user_id AND role='owner'
        AND approval='approved' AND "emailVerified" IS TRUE)
       OR NOT EXISTS (SELECT 1 FROM auth_user WHERE id=NEW.target_user_id AND role IN ('member','owner')
        AND approval='approved' AND "emailVerified" IS TRUE)
       OR NOT EXISTS (SELECT 1 FROM directory_business WHERE id=NEW.business_id
        AND owner_user_id=NEW.target_user_id AND version=NEW.result_version) THEN
        RAISE EXCEPTION 'ownership_receipt_state_required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER directory_ownership_receipt_insert_guard BEFORE INSERT ON directory_ownership_transfer
FOR EACH ROW EXECUTE FUNCTION directory_ownership_receipt_guard();

CREATE FUNCTION directory_ownership_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ownership_history_is_immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER directory_ownership_receipt_immutable BEFORE UPDATE OR DELETE ON directory_ownership_transfer
FOR EACH ROW EXECUTE FUNCTION directory_ownership_history_immutable();
