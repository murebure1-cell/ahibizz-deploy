-- Private editorial drafts belong to a particular owner and public listing.
ALTER TABLE directory_business ADD COLUMN editorial_revision jsonb
    CHECK (editorial_revision IS NULL OR (status='published' AND jsonb_typeof(editorial_revision)='object' AND editorial_revision <> '{}'::jsonb));
CREATE TABLE directory_business_image_proposal (
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('logo','cover','gallery')),
    slot integer NOT NULL,
    bytes bytea, mime text, width integer, height integer,
    version integer NOT NULL CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id,kind,slot),
    CHECK ((kind IN ('logo','cover') AND slot=0) OR (kind='gallery' AND slot BETWEEN 1 AND 8)),
    CHECK ((bytes IS NULL AND mime IS NULL AND width IS NULL AND height IS NULL)
        OR (bytes IS NOT NULL AND mime IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL
         AND octet_length(bytes) BETWEEN 1 AND 1048576 AND mime='image/webp'
         AND ((kind='logo' AND width=512 AND height=512)
           OR (kind='cover' AND width=1600 AND height=600)
           OR (kind='gallery' AND width BETWEEN 1 AND 1600 AND height BETWEEN 1 AND 1200))))
);
CREATE FUNCTION directory_discard_stale_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.editorial_revision := NULL;
        DELETE FROM directory_business_image_proposal WHERE business_id=OLD.id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER directory_discard_stale_revision BEFORE UPDATE OF owner_user_id,status ON directory_business
FOR EACH ROW EXECUTE FUNCTION directory_discard_stale_revision();
ALTER TABLE directory_moderation_audit DROP CONSTRAINT directory_moderation_audit_action_check;
ALTER TABLE directory_moderation_audit ADD CHECK (action IN ('publish','moderate','owner-update','approve-changes','reject-changes'));

-- Expanding pg_timezone_names computes offsets for every zone. Do that once outside
-- interactive writes. Refresh this view after PostgreSQL timezone data is updated.
CREATE MATERIALIZED VIEW directory_timezone_names AS
    SELECT DISTINCT name FROM pg_catalog.pg_timezone_names;
CREATE UNIQUE INDEX directory_timezone_names_name_idx ON directory_timezone_names (name);

-- Hours-only edits reuse the already validated zone, keeping the business lock short.
CREATE OR REPLACE FUNCTION directory_business_details_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
    IF TG_OP='UPDATE' AND (NEW.business_id<>OLD.business_id OR NEW.business_version<=OLD.business_version) THEN
        RAISE EXCEPTION 'business_details_identity_or_version_invalid' USING ERRCODE='23514';
    END IF;
    SELECT version INTO current_version FROM directory_business WHERE id=NEW.business_id FOR SHARE;
    IF current_version IS NULL OR NEW.business_version<>current_version THEN
        RAISE EXCEPTION 'business_details_global_version_required' USING ERRCODE='23514';
    END IF;
    IF NEW.timezone IS NOT NULL AND (TG_OP='INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone) THEN
        IF NOT EXISTS (SELECT 1 FROM directory_timezone_names WHERE name=NEW.timezone) THEN
            RAISE EXCEPTION 'business_details_timezone_invalid' USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
