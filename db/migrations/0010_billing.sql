-- Confirmed cash receipts and internal calculated earmarks only.
-- No payment processor, subscription activation, investment or Foundation transfer.
CREATE TABLE billing_receipt (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('subscription','photo_video')),
    package_id text CHECK (package_id IN ('basic','business','premium')),
    period text CHECK (period IN ('monthly','annual')),
    business_id uuid REFERENCES directory_business(id) ON DELETE RESTRICT,
    business_title text CHECK (char_length(business_title) BETWEEN 1 AND 120),
    catalog_version integer,
    quoted_price_minor integer,
    commitment_months integer,
    commitment_total_minor integer,
    service_starts_on date,
    service_ends_on date,
    source text NOT NULL CHECK (source IN ('bank','paypal','cash','other')),
    external_reference text NOT NULL CHECK (external_reference=btrim(external_reference) AND char_length(external_reference) BETWEEN 1 AND 120),
    received_at timestamptz NOT NULL,
    gross_minor integer NOT NULL CHECK (gross_minor BETWEEN 1 AND 1000000000),
    refunded_minor integer NOT NULL DEFAULT 0 CHECK (refunded_minor BETWEEN 0 AND gross_minor),
    tax_minor integer CHECK (tax_minor BETWEEN 0 AND 1000000000),
    fee_minor integer CHECK (fee_minor BETWEEN 0 AND 1000000000),
    net_base_minor integer,
    development_rate_bps integer CHECK (development_rate_bps BETWEEN 0 AND 10000),
    development_minor integer,
    allocation_status text NOT NULL CHECK (allocation_status IN ('pending','posted','not_applicable')),
    created_by_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1 CHECK (version>=1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, external_reference),
    CHECK ((business_id IS NULL)=(business_title IS NULL)),
    CHECK ((service_starts_on IS NULL)=(service_ends_on IS NULL)),
    CHECK (service_starts_on IS NULL OR service_ends_on>service_starts_on),
    CHECK ((kind='subscription' AND package_id IS NOT NULL AND period IS NOT NULL
            AND business_id IS NOT NULL AND catalog_version IS NOT NULL AND catalog_version>=1
            AND quoted_price_minor IS NOT NULL AND quoted_price_minor>0
            AND commitment_months IS NOT NULL AND commitment_months=12
            AND commitment_total_minor IS NOT NULL AND commitment_total_minor>0 AND service_starts_on IS NOT NULL)
        OR (kind='photo_video' AND package_id IS NULL AND period IS NULL AND catalog_version IS NULL
            AND quoted_price_minor IS NULL AND commitment_months IS NULL AND commitment_total_minor IS NULL)),
    CHECK (net_base_minor IS NOT DISTINCT FROM CASE WHEN tax_minor IS NULL OR fee_minor IS NULL THEN NULL ELSE GREATEST(0,gross_minor-refunded_minor-tax_minor-fee_minor) END),
    CHECK ((kind='photo_video' AND development_rate_bps IS NULL AND development_minor IS NULL AND allocation_status='not_applicable')
        OR (kind='subscription' AND ((net_base_minor IS NULL OR development_rate_bps IS NULL) AND development_minor IS NULL AND allocation_status='pending'
            OR net_base_minor IS NOT NULL AND development_rate_bps IS NOT NULL AND allocation_status='posted'
              AND development_minor IS NOT NULL AND development_minor=((net_base_minor::bigint*development_rate_bps+5000)/10000))))
);
CREATE INDEX billing_receipt_created_idx ON billing_receipt (created_at DESC,id DESC);
CREATE INDEX billing_receipt_business_idx ON billing_receipt (business_id,created_at DESC,id DESC);

CREATE TABLE billing_create_command (
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    receipt_id uuid NOT NULL REFERENCES billing_receipt(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_user_id,request_id)
);
CREATE TABLE billing_receipt_event (
    id uuid PRIMARY KEY,
    receipt_id uuid NOT NULL REFERENCES billing_receipt(id) ON DELETE RESTRICT,
    actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('create','adjust')),
    previous_version integer NOT NULL CHECK (previous_version>=0),
    next_version integer NOT NULL CHECK (next_version=previous_version+1),
    previous_facts jsonb,
    next_facts jsonb NOT NULL CHECK (jsonb_typeof(next_facts)='object'),
    development_delta_minor integer NOT NULL,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (receipt_id,next_version),
    CHECK ((action='create' AND previous_version=0 AND previous_facts IS NULL)
        OR (action='adjust' AND previous_version>=1 AND previous_facts IS NOT NULL AND jsonb_typeof(previous_facts)='object'))
);
CREATE TABLE billing_development_ledger (
    id uuid PRIMARY KEY,
    event_id uuid NOT NULL UNIQUE REFERENCES billing_receipt_event(id) ON DELETE RESTRICT,
    receipt_id uuid NOT NULL,
    receipt_version integer NOT NULL,
    delta_minor integer NOT NULL,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (receipt_id,receipt_version) REFERENCES billing_receipt_event(receipt_id,next_version) ON DELETE RESTRICT
);
CREATE INDEX billing_development_created_idx ON billing_development_ledger (created_at DESC,id DESC);

CREATE FUNCTION billing_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'billing_receipt_no_delete' USING ERRCODE='23514'; END IF;
    IF (NEW.id,NEW.kind,NEW.package_id,NEW.period,NEW.business_id,NEW.business_title,NEW.catalog_version,
        NEW.quoted_price_minor,NEW.commitment_months,NEW.commitment_total_minor,NEW.source,NEW.external_reference,
        NEW.received_at,NEW.gross_minor,NEW.development_rate_bps,NEW.created_by_user_id,NEW.created_at)
       IS DISTINCT FROM
       (OLD.id,OLD.kind,OLD.package_id,OLD.period,OLD.business_id,OLD.business_title,OLD.catalog_version,
        OLD.quoted_price_minor,OLD.commitment_months,OLD.commitment_total_minor,OLD.source,OLD.external_reference,
        OLD.received_at,OLD.gross_minor,OLD.development_rate_bps,OLD.created_by_user_id,OLD.created_at)
       OR NEW.version<>OLD.version+1 OR NEW.refunded_minor<OLD.refunded_minor THEN
        RAISE EXCEPTION 'billing_receipt_immutable_identity_or_version' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_receipt_identity_guard BEFORE UPDATE OR DELETE ON billing_receipt FOR EACH ROW EXECUTE FUNCTION billing_receipt_guard();
CREATE FUNCTION billing_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'billing_history_is_append_only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER billing_command_immutable BEFORE UPDATE OR DELETE ON billing_create_command FOR EACH ROW EXECUTE FUNCTION billing_history_immutable();
CREATE TRIGGER billing_event_immutable BEFORE UPDATE OR DELETE ON billing_receipt_event FOR EACH ROW EXECUTE FUNCTION billing_history_immutable();
CREATE TRIGGER billing_development_immutable BEFORE UPDATE OR DELETE ON billing_development_ledger FOR EACH ROW EXECUTE FUNCTION billing_history_immutable();
CREATE FUNCTION billing_development_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_event billing_receipt_event%ROWTYPE;
BEGIN
    SELECT * INTO source_event FROM billing_receipt_event WHERE id=NEW.event_id;
    IF NOT FOUND OR source_event.receipt_id<>NEW.receipt_id OR source_event.next_version<>NEW.receipt_version
       OR source_event.development_delta_minor<>NEW.delta_minor
       OR source_event.next_facts->>'kind' IS DISTINCT FROM 'subscription'
       OR NOT EXISTS (SELECT 1 FROM billing_receipt WHERE id=NEW.receipt_id AND kind='subscription') THEN
        RAISE EXCEPTION 'billing_development_invalid_event' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_development_event_guard BEFORE INSERT ON billing_development_ledger FOR EACH ROW EXECUTE FUNCTION billing_development_guard();
