-- Personal profiles remain private until the account explicitly opts in.
ALTER TABLE personal_profile ADD COLUMN is_public boolean NOT NULL DEFAULT false;
CREATE INDEX personal_profile_public_idx ON personal_profile (user_id) WHERE is_public;

-- One canonical row per unordered pair, including terminal request history.
CREATE TABLE people_connection (
    id uuid PRIMARY KEY,
    left_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    right_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    requester_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','removed')),
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (left_user_id, right_user_id),
    CHECK (left_user_id COLLATE "C" < right_user_id COLLATE "C"),
    CHECK (requester_user_id IN (left_user_id, right_user_id))
);
CREATE INDEX people_connection_left_idx ON people_connection (left_user_id, status, updated_at DESC, id);
CREATE INDEX people_connection_right_idx ON people_connection (right_user_id, status, updated_at DESC, id);

CREATE FUNCTION people_connection_validate_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' OR NEW.version <> 1 THEN
            RAISE EXCEPTION 'connection_invalid_initial_state' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.id <> OLD.id OR NEW.left_user_id <> OLD.left_user_id OR NEW.right_user_id <> OLD.right_user_id
           OR NEW.version <> OLD.version + 1 OR NOT (
               (OLD.status = 'pending' AND NEW.status IN ('accepted','declined','cancelled') AND NEW.requester_user_id = OLD.requester_user_id)
               OR (OLD.status = 'accepted' AND NEW.status = 'removed' AND NEW.requester_user_id = OLD.requester_user_id)
               OR (OLD.status IN ('declined','cancelled','removed') AND NEW.status = 'pending')
           ) THEN
            RAISE EXCEPTION 'connection_invalid_transition' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER people_connection_state_guard BEFORE INSERT OR UPDATE ON people_connection
FOR EACH ROW EXECUTE FUNCTION people_connection_validate_change();

-- Receipts contain only state, never public or private profile text/media.
CREATE TABLE people_connection_command (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    connection_id uuid NOT NULL REFERENCES people_connection(id) ON DELETE RESTRICT,
    person_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    result_status text NOT NULL CHECK (result_status IN ('pending','accepted','declined','cancelled','removed')),
    result_direction text NOT NULL CHECK (result_direction IN ('incoming','outgoing')),
    result_version integer NOT NULL CHECK (result_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, request_id)
);
CREATE TABLE people_connection_event (
    id uuid PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES people_connection(id) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('request','accept','decline','cancel','remove')),
    previous_status text CHECK (previous_status IN ('pending','accepted','declined','cancelled','removed')),
    next_status text NOT NULL CHECK (next_status IN ('pending','accepted','declined','cancelled','removed')),
    previous_version integer NOT NULL CHECK (previous_version >= 0),
    next_version integer NOT NULL CHECK (next_version = previous_version + 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (connection_id, next_version),
    CHECK ((previous_version = 0 AND previous_status IS NULL AND action = 'request') OR (previous_version >= 1 AND previous_status IS NOT NULL)),
    CHECK ((action = 'request' AND next_status = 'pending') OR (action = 'accept' AND previous_status = 'pending' AND next_status = 'accepted') OR (action = 'decline' AND previous_status = 'pending' AND next_status = 'declined') OR (action = 'cancel' AND previous_status = 'pending' AND next_status = 'cancelled') OR (action = 'remove' AND previous_status = 'accepted' AND next_status = 'removed'))
);

CREATE TABLE personal_profile_visibility_command (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    result_is_public boolean NOT NULL,
    result_profile_version integer NOT NULL CHECK (result_profile_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, request_id)
);
CREATE TABLE personal_profile_visibility_event (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    previous_is_public boolean NOT NULL,
    next_is_public boolean NOT NULL,
    previous_profile_version integer NOT NULL CHECK (previous_profile_version >= 0),
    next_profile_version integer NOT NULL CHECK (next_profile_version = previous_profile_version + 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, next_profile_version)
);
