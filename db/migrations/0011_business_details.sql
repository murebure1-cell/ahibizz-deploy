-- Optional owner-supplied business facts. No operating schedule is inferred from booking.
CREATE FUNCTION directory_business_details_hours_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE day jsonb; win jsonb; day_index integer := 0; previous_end integer; start_minute integer; end_minute integer;
BEGIN
    IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) <> 7 THEN RETURN false; END IF;
    FOR day IN SELECT * FROM jsonb_array_elements(value) LOOP
        day_index := day_index + 1;
        IF jsonb_typeof(day) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(day)) <> 2
            OR NOT (day ?& ARRAY['weekday','windows']) OR day->'weekday' <> to_jsonb(day_index)
            OR jsonb_typeof(day->'windows') <> 'array' OR jsonb_array_length(day->'windows') > 4 THEN RETURN false; END IF;
        previous_end := -1;
        FOR win IN SELECT * FROM jsonb_array_elements(day->'windows') LOOP
            IF jsonb_typeof(win) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(win)) <> 2
                OR NOT (win ?& ARRAY['startMinute','endMinute'])
                OR jsonb_typeof(win->'startMinute') <> 'number' OR jsonb_typeof(win->'endMinute') <> 'number'
                OR (win->>'startMinute') !~ '^[0-9]{1,4}$' OR (win->>'endMinute') !~ '^[0-9]{1,4}$' THEN RETURN false; END IF;
            start_minute := (win->>'startMinute')::integer; end_minute := (win->>'endMinute')::integer;
            IF start_minute < previous_end OR start_minute < 0 OR start_minute >= end_minute OR end_minute > 1440 THEN RETURN false; END IF;
            previous_end := end_minute;
        END LOOP;
    END LOOP;
    RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
CREATE FUNCTION directory_business_details_amenities_valid(value text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT cardinality(value) <= 6 AND (cardinality(value)=0 OR array_ndims(value)=1)
        AND array_position(value, NULL) IS NULL
        AND value <@ ARRAY['wifi','parking','accessible','pets','card-payment','family']::text[]
        AND cardinality(value)=(SELECT count(DISTINCT entry) FROM unnest(value) entry);
$$;
CREATE TABLE directory_business_details (
    business_id uuid PRIMARY KEY REFERENCES directory_business(id) ON DELETE RESTRICT,
    timezone text,
    hours jsonb,
    amenities text[] NOT NULL DEFAULT '{}',
    business_version integer NOT NULL CHECK (business_version >= 2),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((timezone IS NULL AND hours IS NULL) OR
        (timezone IS NOT NULL AND length(timezone) BETWEEN 1 AND 64 AND hours IS NOT NULL AND directory_business_details_hours_valid(hours))),
    CHECK (directory_business_details_amenities_valid(amenities))
);
CREATE FUNCTION directory_business_details_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
    IF TG_OP='UPDATE' AND (NEW.business_id<>OLD.business_id OR NEW.business_version<=OLD.business_version) THEN
        RAISE EXCEPTION 'business_details_identity_or_version_invalid' USING ERRCODE='23514';
    END IF;
    SELECT version INTO current_version FROM directory_business WHERE id=NEW.business_id FOR SHARE;
    IF current_version IS NULL OR NEW.business_version<>current_version THEN
        RAISE EXCEPTION 'business_details_global_version_required' USING ERRCODE='23514';
    END IF;
    IF NEW.timezone IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN
        RAISE EXCEPTION 'business_details_timezone_invalid' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER directory_business_details_version_guard BEFORE INSERT OR UPDATE ON directory_business_details
FOR EACH ROW EXECUTE FUNCTION directory_business_details_version_guard();
