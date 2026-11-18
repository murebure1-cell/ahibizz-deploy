ALTER TABLE directory_category ADD COLUMN accommodation boolean NOT NULL DEFAULT false;
INSERT INTO directory_category(id,name,slug,accommodation) VALUES
    ('0313e131-f474-4c2e-ad13-9bbfb2a6eb72','Smještaj','smjestaj',true)
    ON CONFLICT(slug) DO UPDATE SET accommodation=true;

CREATE TABLE stay_unit (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    unit_key bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    free_slot smallint CHECK (free_slot BETWEEN 1 AND 2),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    type text NOT NULL CHECK (type IN ('room','apartment')),
    beds smallint NOT NULL CHECK (beds BETWEEN 1 AND 99),
    description text CHECK (length(description) BETWEEN 1 AND 1000),
    price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
    enabled boolean NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    archived_at timestamptz,
    UNIQUE (business_id,free_slot),
    UNIQUE (id,business_id),
    UNIQUE (id,business_id,unit_key),
    CHECK ((archived_at IS NULL) = (free_slot IS NOT NULL)),
    CHECK (archived_at IS NULL OR NOT enabled)
);
CREATE TABLE stay_unit_photo (
    unit_id uuid NOT NULL,
    business_id uuid NOT NULL,
    kind text NOT NULL DEFAULT 'gallery' CHECK (kind='gallery'),
    slot integer NOT NULL CHECK (slot BETWEEN 1 AND 8),
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
    PRIMARY KEY(unit_id,slot),
    UNIQUE(unit_id,position),
    FOREIGN KEY(unit_id,business_id) REFERENCES stay_unit(id,business_id),
    FOREIGN KEY(business_id,kind,slot) REFERENCES directory_business_image(business_id,kind,slot) ON DELETE CASCADE
);
CREATE INDEX stay_unit_photo_gallery_idx ON stay_unit_photo(business_id,kind,slot);

CREATE TABLE stay_booking (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    unit_key bigint NOT NULL,
    FOREIGN KEY(unit_id,business_id,unit_key) REFERENCES stay_unit(id,business_id,unit_key) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    UNIQUE(actor_user_id,request_id),
    unit_version integer NOT NULL CHECK (unit_version>0),
    unit_name text NOT NULL,
    business_title text NOT NULL,
    timezone text NOT NULL,
    customer_id text REFERENCES auth_user(id) ON DELETE RESTRICT,
    customer_name text,
    kind text NOT NULL CHECK (kind IN ('customer','block')),
    status text NOT NULL CHECK (status IN ('requested','confirmed','cancelled','declined')),
    check_in date NOT NULL,
    check_out date NOT NULL CHECK (check_out>check_in),
    price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
    total_minor bigint NOT NULL CHECK (total_minor>=0),
    version integer NOT NULL DEFAULT 1 CHECK (version>=1),
    CHECK ((kind='customer' AND customer_id=actor_user_id AND customer_id IS NOT NULL AND customer_name IS NOT NULL
           AND total_minor=price_minor::bigint*(check_out-check_in))
        OR (kind='block' AND customer_id IS NULL AND customer_name IS NULL AND status IN ('confirmed','cancelled') AND total_minor=0)),
    CONSTRAINT stay_booking_no_overlap EXCLUDE USING gist
        (int8range(unit_key,unit_key,'[]') WITH &&, daterange(check_in,check_out,'[)') WITH &&)
        WHERE (status IN ('requested','confirmed'))
);
CREATE INDEX stay_calendar_idx ON stay_booking(unit_id,check_in,check_out);
CREATE INDEX stay_customer_idx ON stay_booking(customer_id,check_in DESC);
CREATE TABLE stay_booking_event (
    booking_id uuid NOT NULL REFERENCES stay_booking(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version>=1),
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('request','block','approve','decline','cancel')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(booking_id,version)
);
