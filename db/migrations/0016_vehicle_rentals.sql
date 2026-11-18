-- Capabilities are attached to category identities and inherited by subcategories.
ALTER TABLE directory_category ADD COLUMN vehicle_rental boolean NOT NULL DEFAULT false;
UPDATE directory_category SET vehicle_rental=true
 WHERE id='d33ed834-0dd0-4007-8760-78401d0631a1'
   AND parent_id='ac14d8d1-1aa7-4149-87e6-7917f97c1236';

CREATE TABLE rental_vehicle (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    vehicle_key bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    free_slot smallint CHECK (free_slot BETWEEN 1 AND 2),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    brand text NOT NULL CHECK (length(brand) BETWEEN 1 AND 60),
    model text NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
    year smallint CHECK (year BETWEEN 1886 AND 9999),
    seats smallint NOT NULL CHECK (seats BETWEEN 1 AND 99),
    fuel text NOT NULL CHECK (fuel IN ('petrol','diesel','hybrid','electric')),
    transmission text NOT NULL CHECK (transmission IN ('manual','automatic')),
    description text CHECK (length(description) BETWEEN 1 AND 1000),
    photo_slot smallint CHECK (photo_slot BETWEEN 1 AND 8),
    price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
    price_unit text NOT NULL CHECK (price_unit IN ('hour','day')),
    enabled boolean NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    archived_at timestamptz,
    UNIQUE (business_id,free_slot),
    UNIQUE (id,business_id,vehicle_key),
    CHECK ((archived_at IS NULL) = (free_slot IS NOT NULL)),
    CHECK (archived_at IS NULL OR NOT enabled)
);

CREATE TABLE rental_booking (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    vehicle_key bigint NOT NULL,
    FOREIGN KEY (vehicle_id,business_id,vehicle_key) REFERENCES rental_vehicle(id,business_id,vehicle_key) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    UNIQUE (actor_user_id, request_id),
    vehicle_version integer NOT NULL CHECK (vehicle_version > 0),
    vehicle_name text NOT NULL,
    business_title text NOT NULL,
    timezone text NOT NULL,
    customer_id text REFERENCES auth_user(id) ON DELETE RESTRICT,
    customer_name text,
    kind text NOT NULL CHECK (kind IN ('customer','block')),
    status text NOT NULL CHECK (status IN ('requested','confirmed','cancelled','declined')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
    price_unit text NOT NULL CHECK (price_unit IN ('hour','day')),
    total_minor bigint NOT NULL CHECK (total_minor >= 0),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    CHECK ((kind='customer' AND customer_id IS NOT NULL AND customer_id=actor_user_id AND customer_name IS NOT NULL)
       OR (kind='block' AND customer_id IS NULL AND customer_name IS NULL AND status IN ('confirmed','cancelled') AND total_minor=0)),
    -- Both range types have built-in GiST support. This database constraint arbitrates
    -- concurrent inserts and status updates across every writer without btree_gist.
    CONSTRAINT rental_booking_no_overlap EXCLUDE USING gist
        (int8range(vehicle_key,vehicle_key,'[]') WITH &&, tstzrange(starts_at,ends_at,'[)') WITH &&)
        WHERE (status IN ('requested','confirmed'))
);
CREATE INDEX rental_calendar_idx ON rental_booking(vehicle_id,starts_at,ends_at);
CREATE INDEX rental_customer_idx ON rental_booking(customer_id,starts_at DESC);
CREATE TABLE rental_booking_event (
    booking_id uuid NOT NULL REFERENCES rental_booking(id) ON DELETE RESTRICT,
    version integer NOT NULL CHECK (version >= 1),
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('request','block','approve','decline','cancel')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(booking_id,version)
);
