CREATE FUNCTION personal_profile_skills_valid(value text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT cardinality(value) <= 15
        AND COALESCE(array_ndims(value), 1) = 1
        AND NOT EXISTS (SELECT 1 FROM unnest(value) item WHERE item IS NULL OR item <> btrim(item) OR char_length(item) NOT BETWEEN 1 AND 40)
        AND cardinality(value) = (SELECT count(DISTINCT lower(item)) FROM unnest(value) item)
$$;

CREATE TABLE personal_profile (
    user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
    birth_date date CHECK (birth_date >= DATE '0001-01-01' AND birth_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date),
    city text CHECK (char_length(city) BETWEEN 1 AND 100 AND city = btrim(city)),
    country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
    bio text CHECK (char_length(bio) BETWEEN 1 AND 1200 AND bio = btrim(bio)),
    skills text[] NOT NULL DEFAULT '{}' CHECK (personal_profile_skills_valid(skills)),
    work_status text NOT NULL DEFAULT 'not_specified' CHECK (work_status IN ('not_specified', 'employed', 'self_employed', 'business_owner', 'student', 'seeking_work', 'open_to_collaboration')),
    version integer NOT NULL CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- An entitlement is an explicit server-side grant. No billing plan or user-controlled setter is implied.
CREATE TABLE personal_profile_entitlement (
    user_id text PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
    can_customize_cover boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only normalized raster output is stored; raw uploads and filenames are never persisted.
CREATE TABLE personal_profile_image (
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('photo', 'cover')),
    bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
    mime text NOT NULL CHECK (mime = 'image/webp'),
    width integer NOT NULL,
    height integer NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind),
    CHECK ((kind = 'photo' AND width = 512 AND height = 512) OR (kind = 'cover' AND width = 1600 AND height = 600))
);
