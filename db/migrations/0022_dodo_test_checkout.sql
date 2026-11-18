-- Test-mode Dodo prototype. No production promotion table or predicate references these rows.
CREATE TABLE dodo_test_order (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES auth_user(id), request_id uuid NOT NULL,
 business_id uuid NOT NULL REFERENCES directory_business(id), category_id uuid NOT NULL REFERENCES directory_category(id),
 merchant_id text NOT NULL, product_id text NOT NULL, environment text NOT NULL DEFAULT 'test_mode' CHECK(environment='test_mode'),
 purpose text NOT NULL DEFAULT 'promotion' CHECK(purpose='promotion'), amount_minor integer NOT NULL DEFAULT 511 CHECK(amount_minor=511), currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','reserved','provider_created','ambiguous','verified','review')),
 session_id text UNIQUE, checkout_url text, payment_id text UNIQUE,
 test_starts_at timestamptz, test_ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 UNIQUE(user_id,request_id), CHECK((test_starts_at IS NULL AND test_ends_at IS NULL) OR test_ends_at=test_starts_at+interval '7 days')
);
CREATE TABLE dodo_test_command (
 namespace text NOT NULL, command_key uuid NOT NULL, order_id uuid NOT NULL UNIQUE REFERENCES dodo_test_order(id),
 fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('reserved','completed','ambiguous')), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(namespace,command_key)
);
CREATE TABLE dodo_test_inbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, namespace text NOT NULL, event_id text NOT NULL,
 raw text NOT NULL, hash text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','review')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(namespace,event_id)
);
CREATE INDEX dodo_test_inbox_pending ON dodo_test_inbox(id) WHERE status='pending';
-- A verified test receipt is never authority for a public directory promotion.
CREATE FUNCTION dodo_test_revoke_business() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.status IS DISTINCT FROM OLD.status THEN
 UPDATE dodo_test_order SET status='review' WHERE business_id=NEW.id AND status='verified';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER dodo_test_business_changed AFTER UPDATE ON directory_business FOR EACH ROW EXECUTE FUNCTION dodo_test_revoke_business();
CREATE FUNCTION dodo_test_revoke_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.approval IS DISTINCT FROM OLD.approval OR NEW.role IS DISTINCT FROM OLD.role OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified" THEN
 UPDATE dodo_test_order SET status='review' WHERE user_id=NEW.id AND status='verified';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER dodo_test_user_changed AFTER UPDATE ON auth_user FOR EACH ROW EXECUTE FUNCTION dodo_test_revoke_user();
CREATE FUNCTION dodo_test_immutable_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.user_id,NEW.request_id,NEW.business_id,NEW.category_id,NEW.merchant_id,NEW.product_id,NEW.environment,NEW.purpose,NEW.amount_minor,NEW.currency) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.request_id,OLD.business_id,OLD.category_id,OLD.merchant_id,OLD.product_id,OLD.environment,OLD.purpose,OLD.amount_minor,OLD.currency)
 OR (OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id)
 OR (OLD.checkout_url IS NOT NULL AND NEW.checkout_url IS DISTINCT FROM OLD.checkout_url)
 OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
 OR (OLD.test_starts_at IS NOT NULL AND (NEW.test_starts_at,NEW.test_ends_at) IS DISTINCT FROM (OLD.test_starts_at,OLD.test_ends_at))
 THEN RAISE EXCEPTION 'Dodo test order identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dodo_test_order_immutable BEFORE UPDATE ON dodo_test_order FOR EACH ROW EXECUTE FUNCTION dodo_test_immutable_order();
