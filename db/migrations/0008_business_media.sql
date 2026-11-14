-- Business images contain normalized static WebP only; never raw input or filenames.
CREATE TABLE directory_business_image (
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('logo','cover','gallery')),
    slot integer NOT NULL,
    bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
    mime text NOT NULL CHECK (mime='image/webp'),
    width integer NOT NULL,
    height integer NOT NULL,
    version integer NOT NULL CHECK (version>=1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id,kind,slot),
    CHECK ((kind='logo' AND slot=0 AND width=512 AND height=512)
        OR (kind='cover' AND slot=0 AND width=1600 AND height=600)
        OR (kind='gallery' AND slot BETWEEN 1 AND 8 AND width BETWEEN 1 AND 1600 AND height BETWEEN 1 AND 1200))
);
CREATE FUNCTION directory_business_image_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business_version integer;
BEGIN
    IF TG_OP='UPDATE' AND (NEW.business_id<>OLD.business_id OR NEW.kind<>OLD.kind OR NEW.slot<>OLD.slot OR NEW.version<=OLD.version) THEN
        RAISE EXCEPTION 'business_media_invalid_identity_or_version' USING ERRCODE='23514';
    END IF;
    SELECT version INTO business_version FROM directory_business WHERE id=NEW.business_id FOR SHARE;
    IF business_version IS NULL OR NEW.version<>business_version THEN
        RAISE EXCEPTION 'business_media_global_version_required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER directory_business_image_version_guard BEFORE INSERT OR UPDATE ON directory_business_image
FOR EACH ROW EXECUTE FUNCTION directory_business_image_version_guard();

-- A receipt confirms the original command. Current status/images always require a fresh read.
CREATE TABLE directory_business_media_command (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    input_sha256 text CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
    operation text NOT NULL CHECK (operation IN ('put','delete')),
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('logo','cover','gallery')),
    slot integer NOT NULL,
    result_business_version integer NOT NULL CHECK (result_business_version>=2),
    result_status text NOT NULL CHECK (result_status IN ('draft','pending','published')),
    result_media_version integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id,request_id),
    CHECK ((kind IN ('logo','cover') AND slot=0) OR (kind='gallery' AND slot BETWEEN 1 AND 8)),
    CHECK ((operation='put' AND input_sha256 IS NOT NULL AND result_media_version IS NOT NULL AND result_media_version=result_business_version)
        OR (operation='delete' AND input_sha256 IS NULL AND result_media_version IS NULL))
);
CREATE TABLE directory_business_media_event (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    operation text NOT NULL CHECK (operation IN ('put','delete')),
    kind text NOT NULL CHECK (kind IN ('logo','cover','gallery')),
    slot integer NOT NULL,
    previous_business_version integer NOT NULL CHECK (previous_business_version>=1),
    next_business_version integer NOT NULL CHECK (next_business_version=previous_business_version+1),
    previous_media_version integer,
    next_media_version integer,
    previous_status text NOT NULL CHECK (previous_status IN ('draft','pending','published')),
    next_status text NOT NULL CHECK (next_status IN ('draft','pending','published')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id,next_business_version),
    CHECK ((kind IN ('logo','cover') AND slot=0) OR (kind='gallery' AND slot BETWEEN 1 AND 8)),
    CHECK (previous_media_version IS NULL OR previous_media_version BETWEEN 1 AND previous_business_version),
    CHECK ((operation='put' AND next_media_version IS NOT NULL AND next_media_version=next_business_version)
        OR (operation='delete' AND previous_media_version IS NOT NULL AND next_media_version IS NULL))
);
CREATE FUNCTION directory_business_media_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'business_media_history_is_append_only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER directory_business_media_command_immutable BEFORE UPDATE OR DELETE ON directory_business_media_command
FOR EACH ROW EXECUTE FUNCTION directory_business_media_history_immutable();
CREATE TRIGGER directory_business_media_event_immutable BEFORE UPDATE OR DELETE ON directory_business_media_event
FOR EACH ROW EXECUTE FUNCTION directory_business_media_history_immutable();
