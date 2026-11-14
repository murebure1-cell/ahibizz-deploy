-- Booking is opt-in. No schedules, services, bookings or credits are seeded.
CREATE TABLE booking_settings (
    business_id uuid PRIMARY KEY REFERENCES directory_business(id) ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT false,
    timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
    windows jsonb NOT NULL CHECK (jsonb_typeof(windows) = 'array' AND jsonb_array_length(windows) <= 28),
    service_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(service_ids) <= 20),
    version integer NOT NULL CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_service (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240 AND duration_minutes % 5 = 0),
    price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
    currency text NOT NULL DEFAULT 'BAM' CHECK (currency = 'BAM'),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, business_id)
);
CREATE INDEX booking_service_business_idx ON booking_service (business_id, active);

CREATE TABLE booking_entry (
    id uuid PRIMARY KEY,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    business_owner_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    business_title text NOT NULL CHECK (char_length(business_title) BETWEEN 1 AND 120),
    customer_user_id text REFERENCES auth_user(id) ON DELETE RESTRICT,
    created_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('customer', 'manual', 'block')),
    status text NOT NULL CHECK (status IN ('requested', 'confirmed', 'cancelled', 'completed', 'declined')),
    service_id uuid,
    service_name text CHECK (char_length(service_name) BETWEEN 1 AND 120),
    duration_minutes integer CHECK (duration_minutes BETWEEN 15 AND 240 AND duration_minutes % 5 = 0),
    price_minor integer NOT NULL DEFAULT 0 CHECK (price_minor BETWEEN 0 AND 10000000),
    currency text NOT NULL DEFAULT 'BAM' CHECK (currency = 'BAM'),
    timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    client_name text CHECK (char_length(client_name) BETWEEN 1 AND 120),
    client_email text CHECK (char_length(client_email) <= 254),
    client_phone text CHECK (char_length(client_phone) <= 40),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (service_id, business_id) REFERENCES booking_service(id, business_id) ON DELETE RESTRICT,
    CHECK (
      (kind = 'block' AND service_id IS NULL AND service_name IS NULL AND duration_minutes IS NULL AND price_minor = 0 AND customer_user_id IS NULL AND status <> 'completed' AND EXTRACT(EPOCH FROM (ends_at - starts_at)) <= 2678400)
      OR (kind = 'manual' AND service_id IS NOT NULL AND service_name IS NOT NULL AND duration_minutes IS NOT NULL AND customer_user_id IS NULL)
      OR (kind = 'customer' AND service_id IS NOT NULL AND service_name IS NOT NULL AND duration_minutes IS NOT NULL AND customer_user_id IS NOT NULL AND customer_user_id <> business_owner_user_id)
    ),
    CHECK (kind = 'block' OR EXTRACT(EPOCH FROM (ends_at - starts_at)) = duration_minutes * 60)
);
CREATE INDEX booking_entry_business_range_idx ON booking_entry (business_id, status, starts_at, ends_at);
CREATE INDEX booking_entry_customer_idx ON booking_entry (customer_user_id, starts_at DESC, id);

-- Cross-service overlap protection without requiring a database extension.
-- The application uses the same business row lock after sorted auth-user locks.
CREATE FUNCTION booking_reject_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM directory_business WHERE id = NEW.business_id FOR UPDATE;
    IF NEW.status IN ('requested', 'confirmed') AND EXISTS (
        SELECT 1 FROM booking_entry e
        WHERE e.business_id = NEW.business_id AND e.id <> NEW.id
          AND e.status IN ('requested', 'confirmed')
          AND e.starts_at < NEW.ends_at AND e.ends_at > NEW.starts_at
    ) THEN
        RAISE EXCEPTION 'booking_overlap' USING ERRCODE = '23P01';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER booking_entry_overlap_guard
BEFORE INSERT OR UPDATE ON booking_entry
FOR EACH ROW EXECUTE FUNCTION booking_reject_overlap();

CREATE TABLE booking_create_commands (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    entry_id uuid NOT NULL REFERENCES booking_entry(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id, request_id)
);

CREATE TABLE booking_entry_event (
    id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES booking_entry(id) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('create','approve','decline','cancel','complete')),
    previous_status text CHECK (previous_status IN ('requested','confirmed','cancelled','completed','declined')),
    next_status text NOT NULL CHECK (next_status IN ('requested','confirmed','cancelled','completed','declined')),
    previous_version integer NOT NULL CHECK (previous_version >= 0),
    next_version integer NOT NULL CHECK (next_version = previous_version + 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entry_id, next_version),
    CHECK ((action = 'create' AND previous_status IS NULL AND previous_version = 0) OR (action <> 'create' AND previous_status IS NOT NULL AND previous_version >= 1))
);

-- Application credits, not money. A completed customer booking can award exactly once.
CREATE TABLE booking_completion_credit (
    entry_id uuid PRIMARY KEY REFERENCES booking_entry(id) ON DELETE RESTRICT,
    business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
    recipient_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    amount integer NOT NULL CHECK (amount = 5),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_credit_recipient_idx ON booking_completion_credit (recipient_user_id);
CREATE INDEX booking_credit_business_idx ON booking_completion_credit (business_id);

CREATE FUNCTION booking_validate_completion_credit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    appointment booking_entry%ROWTYPE;
BEGIN
    SELECT * INTO appointment FROM booking_entry WHERE id = NEW.entry_id FOR SHARE;
    IF NOT FOUND OR appointment.status <> 'completed' OR appointment.kind <> 'customer'
       OR appointment.customer_user_id IS NULL OR appointment.customer_user_id = appointment.business_owner_user_id
       OR NEW.business_id <> appointment.business_id OR NEW.recipient_user_id <> appointment.business_owner_user_id
       OR appointment.updated_at < appointment.ends_at OR NEW.amount <> 5 THEN
        RAISE EXCEPTION 'booking_credit_not_eligible' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER booking_credit_eligibility_guard
BEFORE INSERT OR UPDATE ON booking_completion_credit
FOR EACH ROW EXECUTE FUNCTION booking_validate_completion_credit();
