-- Empty directory foundation. Categories and fallback labels are created explicitly by an owner.
CREATE TABLE directory_category (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
    parent_id uuid REFERENCES directory_category(id) ON DELETE RESTRICT,
    CHECK (parent_id IS NULL OR parent_id <> id),
    UNIQUE (id, parent_id)
);
CREATE INDEX directory_category_parent_idx ON directory_category (parent_id);

CREATE TABLE directory_business (
    id uuid PRIMARY KEY,
    owner_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    category_id uuid NOT NULL REFERENCES directory_category(id) ON DELETE RESTRICT,
    subcategory_id uuid,
    description text CHECK (char_length(description) <= 4000),
    contact_email text CHECK (char_length(contact_email) <= 254),
    contact_phone text CHECK (char_length(contact_phone) <= 40),
    website_url text CHECK (char_length(website_url) <= 2048),
    address_line text CHECK (char_length(address_line) <= 200),
    city text CHECK (char_length(city) <= 100),
    country_code text CHECK (country_code ~ '^[A-Z]{2}$'),
    latitude double precision CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision CHECK (longitude BETWEEN -180 AND 180),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published', 'archived')),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    is_verified boolean NOT NULL DEFAULT false,
    is_featured boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    archived_at timestamptz,
    FOREIGN KEY (subcategory_id, category_id) REFERENCES directory_category(id, parent_id) ON DELETE RESTRICT,
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX directory_business_owner_idx ON directory_business (owner_user_id, created_at DESC, id);
CREATE INDEX directory_business_public_idx ON directory_business (status, created_at DESC, id);

CREATE TABLE directory_create_commands (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, request_id)
);

CREATE TABLE directory_moderation_audit (
    id uuid PRIMARY KEY,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('publish', 'moderate', 'owner-update')),
    previous_status text NOT NULL CHECK (previous_status IN ('draft', 'pending', 'published')),
    next_status text NOT NULL CHECK (next_status IN ('draft', 'pending', 'published')),
    previous_version integer NOT NULL,
    next_version integer NOT NULL CHECK (next_version = previous_version + 1),
    reason text CHECK (char_length(reason) <= 500),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX directory_moderation_business_idx ON directory_moderation_audit (business_id, created_at, id);
