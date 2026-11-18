-- Durable checkout only. Applying this migration does not enable charging.
CREATE TABLE paypal_checkout_order (
 id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 fingerprint text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('sandbox','live')),
 kind text NOT NULL CHECK(kind IN ('promotion','support')),
 business_id uuid REFERENCES directory_business(id) ON DELETE RESTRICT,
 category_id uuid REFERENCES directory_category(id) ON DELETE RESTRICT,
 business_title text,
 offer_version text NOT NULL,
 original_bam_minor integer,
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 merchant_id text NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 128),
 status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','provider_created','captured','review','partially_refunded','refunded','reversed','cancelled')),
 provider_order_id text,
 approval_url text,
 capture_id text,
 create_request_id uuid NOT NULL UNIQUE,
 capture_request_id uuid NOT NULL UNIQUE,
 refund_total_unknown boolean NOT NULL DEFAULT false,
 refunded_minor integer NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=amount_minor),
 starts_at timestamptz,
 ends_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 capture_lease_until timestamptz,
 captured_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_id),
 UNIQUE(environment,provider_order_id),
 UNIQUE(environment,capture_id),
 CHECK((kind='promotion' AND business_id IS NOT NULL AND category_id IS NOT NULL AND business_title IS NOT NULL AND original_bam_minor=1000) OR (kind='support' AND business_id IS NULL AND category_id IS NULL AND business_title IS NULL AND original_bam_minor IS NULL)),
 CHECK((starts_at IS NULL AND ends_at IS NULL) OR (kind='promotion' AND starts_at IS NOT NULL AND ends_at=starts_at+interval '7 days'))
);
CREATE INDEX paypal_checkout_reconcile_idx ON paypal_checkout_order(updated_at,id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX paypal_checkout_business_idx ON paypal_checkout_order(business_id,created_at DESC);
CREATE TABLE paypal_promotion_entitlement (
 order_id uuid PRIMARY KEY REFERENCES paypal_checkout_order(id) ON DELETE RESTRICT,
 business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
 user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL REFERENCES directory_category(id) ON DELETE RESTRICT,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK(ends_at=starts_at+interval '7 days'),
 revoked_at timestamptz,
 revoke_reason text
);
CREATE INDEX paypal_promotion_lookup_idx ON paypal_promotion_entitlement(business_id,ends_at) WHERE revoked_at IS NULL;
CREATE TABLE paypal_checkout_event (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES paypal_checkout_order(id) ON DELETE RESTRICT,
 action text NOT NULL,
 details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE paypal_webhook_event (
 environment text NOT NULL CHECK(environment IN ('sandbox','live')),
 provider_event_id text NOT NULL,
 order_id uuid NOT NULL REFERENCES paypal_checkout_order(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(environment,provider_event_id)
);
CREATE TABLE paypal_refund_command (
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES paypal_checkout_order(id) ON DELETE RESTRICT,
 actor_user_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 provider_request_id uuid NOT NULL UNIQUE,
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 2 AND 500),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','completed','failed')),
 provider_refund_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_user_id,request_id)
);
-- Changes to the underlying profile permanently revoke an existing right.
CREATE FUNCTION paypal_revoke_business_rights() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.status IS DISTINCT FROM OLD.status THEN
   UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'business_changed') WHERE business_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paypal_business_rights AFTER UPDATE ON directory_business FOR EACH ROW EXECUTE FUNCTION paypal_revoke_business_rights();
CREATE FUNCTION paypal_revoke_user_rights() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.approval IS DISTINCT FROM OLD.approval OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified" OR NEW.role IS DISTINCT FROM OLD.role THEN
   UPDATE paypal_promotion_entitlement SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'account_changed') WHERE user_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paypal_user_rights AFTER UPDATE ON auth_user FOR EACH ROW EXECUTE FUNCTION paypal_revoke_user_rights();

CREATE FUNCTION paypal_checkout_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'checkout_history_no_delete' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.user_id,NEW.request_id,NEW.fingerprint,NEW.environment,NEW.kind,NEW.business_id,NEW.category_id,NEW.business_title,NEW.offer_version,NEW.original_bam_minor,NEW.amount_minor,NEW.currency,NEW.merchant_id,NEW.create_request_id,NEW.capture_request_id,NEW.created_at)
 IS DISTINCT FROM
 (OLD.id,OLD.user_id,OLD.request_id,OLD.fingerprint,OLD.environment,OLD.kind,OLD.business_id,OLD.category_id,OLD.business_title,OLD.offer_version,OLD.original_bam_minor,OLD.amount_minor,OLD.currency,OLD.merchant_id,OLD.create_request_id,OLD.capture_request_id,OLD.created_at)
 THEN RAISE EXCEPTION 'checkout_identity_immutable' USING ERRCODE='23514'; END IF;
 IF OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN RAISE EXCEPTION 'provider_order_immutable' USING ERRCODE='23514'; END IF;
 IF OLD.capture_id IS NOT NULL AND (NEW.capture_id,NEW.captured_at,NEW.starts_at,NEW.ends_at) IS DISTINCT FROM (OLD.capture_id,OLD.captured_at,OLD.starts_at,OLD.ends_at) THEN RAISE EXCEPTION 'capture_identity_immutable' USING ERRCODE='23514'; END IF;
 IF NEW.refunded_minor<OLD.refunded_minor THEN RAISE EXCEPTION 'refund_total_cannot_decrease' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER paypal_checkout_identity BEFORE UPDATE OR DELETE ON paypal_checkout_order FOR EACH ROW EXECUTE FUNCTION paypal_checkout_identity_guard();
