-- One durable review per person and business. Withdrawal and moderation preserve history.
CREATE TABLE business_review (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    author_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body)),
    withdrawn boolean NOT NULL DEFAULT false,
    hidden boolean NOT NULL DEFAULT false,
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, author_user_id)
);
CREATE INDEX business_review_public_idx ON business_review (business_id, created_at DESC, id) WHERE NOT withdrawn AND NOT hidden;
CREATE FUNCTION business_review_validate_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.version <> 1 OR NEW.withdrawn OR NEW.hidden THEN
            RAISE EXCEPTION 'review_invalid_initial_state' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.author_user_id <> OLD.author_user_id
       OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'review_invalid_change' USING ERRCODE = '23514';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.rating IS DISTINCT FROM OLD.rating OR NEW.body IS DISTINCT FROM OLD.body OR (OLD.withdrawn AND NOT NEW.withdrawn))
       AND EXISTS (SELECT 1 FROM directory_business WHERE id=NEW.business_id AND owner_user_id=NEW.author_user_id) THEN
        RAISE EXCEPTION 'review_self_review' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER business_review_state_guard BEFORE INSERT OR UPDATE ON business_review FOR EACH ROW EXECUTE FUNCTION business_review_validate_change();

CREATE TABLE business_review_command (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    review_id uuid NOT NULL REFERENCES business_review(id) ON DELETE RESTRICT,
    result_version integer NOT NULL CHECK (result_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, request_id)
);
CREATE TABLE business_review_event (
    id uuid PRIMARY KEY,
    review_id uuid NOT NULL REFERENCES business_review(id) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('save','withdraw','hide','restore')),
    previous_version integer NOT NULL CHECK (previous_version >= 0),
    next_version integer NOT NULL CHECK (next_version = previous_version + 1),
    previous_rating smallint CHECK (previous_rating BETWEEN 1 AND 5),
    next_rating smallint NOT NULL CHECK (next_rating BETWEEN 1 AND 5),
    reason text CHECK (char_length(reason) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(review_id, next_version),
    CHECK ((action IN ('hide','restore') AND reason IS NOT NULL AND previous_rating=next_rating) OR (action IN ('save','withdraw') AND reason IS NULL))
);
