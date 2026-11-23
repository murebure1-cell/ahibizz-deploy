-- Old payment records remain an archive. Ordinary account/listing changes no longer touch them.
DROP TRIGGER IF EXISTS marketing_listing_change ON directory_business;
DROP TRIGGER IF EXISTS wallet_promotion_listing_change ON directory_business;
DROP TRIGGER IF EXISTS wallet_promotion_user_change ON auth_user;
DROP TRIGGER IF EXISTS paypal_business_rights ON directory_business;
DROP TRIGGER IF EXISTS paypal_user_rights ON auth_user;
CREATE OR REPLACE FUNCTION package_allows_listing(b directory_business) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION paid_package_placement(b directory_business, kind text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION paid_package_placement_until(b directory_business, kind text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT NULL::timestamptz $$;
ALTER TABLE business_reel DROP CONSTRAINT IF EXISTS reel_priced_publication;

CREATE TABLE promotion_price (
  kind text NOT NULL CHECK (kind IN ('home','nearby','category','banner')),
  duration_days integer NOT NULL CHECK (duration_days IN (7,14,30)),
  amount_bam_minor integer NOT NULL CHECK (amount_bam_minor BETWEEN 1 AND 100000000),
  updated_by text REFERENCES auth_user(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(kind,duration_days)
);
INSERT INTO promotion_price(kind,duration_days,amount_bam_minor) VALUES
 ('home',7,2500),('home',14,4500),('home',30,8000),
 ('nearby',7,1500),('nearby',14,2500),('nearby',30,4500),
 ('category',7,1000),('category',14,1800),('category',30,3000),
 ('banner',7,4000),('banner',14,7000),('banner',30,12000);

-- Every capacity mutation locks the corresponding row before checking overlapping periods.
CREATE TABLE promotion_scope (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('home','nearby','category','banner')),
  scope_key text NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 300),
  UNIQUE(kind,scope_key), UNIQUE(id,kind,scope_key),
  CHECK (kind IN ('nearby','category') OR scope_key='*')
);
CREATE TABLE promotion_order (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES directory_business(id) ON DELETE RESTRICT,
  owner_id text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  scope_id bigint NOT NULL,
  scope_key text NOT NULL,
  FOREIGN KEY(scope_id,kind,scope_key) REFERENCES promotion_scope(id,kind,scope_key),
  duration_days integer NOT NULL CHECK(duration_days IN (7,14,30)),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK(ends_at=starts_at+duration_days*interval '24 hours'),
  amount_bam_minor integer NOT NULL CHECK(amount_bam_minor BETWEEN 1 AND 100000000),
  amount_eur_minor integer NOT NULL CHECK(amount_eur_minor=round(amount_bam_minor::numeric*100000/195583)),
  payment_reference text NOT NULL UNIQUE CHECK(payment_reference ~ '^AHI-[a-f0-9]{32}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed','cancelled')),
  confirmed_by text REFERENCES auth_user(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  paid_amount_minor integer,
  paid_currency text CHECK(paid_currency IN ('BAM','EUR')),
  statement_reference text UNIQUE CHECK(length(statement_reference) BETWEEN 1 AND 300),
  manual boolean NOT NULL DEFAULT false,
  note text CHECK(length(note) BETWEEN 1 AND 1000),
  bank_details jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL)),
  CHECK(status NOT IN ('active','completed') OR confirmed_at IS NOT NULL),
  CHECK(NOT manual OR (note IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK((manual AND paid_amount_minor IS NULL AND paid_currency IS NULL) OR
        (NOT manual AND ((confirmed_at IS NULL AND paid_amount_minor IS NULL AND paid_currency IS NULL) OR
          (confirmed_at IS NOT NULL AND paid_currency IS NOT NULL AND paid_amount_minor IS NOT NULL AND
            ((paid_currency='BAM' AND paid_amount_minor=amount_bam_minor) OR
             (paid_currency='EUR' AND paid_amount_minor=amount_eur_minor)))))),
  CHECK(manual OR (bank_details IS NOT NULL AND jsonb_typeof(bank_details)='object'))
);
CREATE INDEX promotion_order_scope_period ON promotion_order(scope_id,starts_at,ends_at)
  WHERE status IN ('pending','active');
CREATE INDEX promotion_order_owner ON promotion_order(owner_id,created_at DESC);
CREATE TABLE promotion_banner_image (
  order_id uuid PRIMARY KEY REFERENCES promotion_order(id) ON DELETE RESTRICT,
  mime text NOT NULL CHECK(mime='image/webp'),
  bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1048576),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK(height BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION guard_promotion_capacity() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE cap integer; b directory_business; point timestamptz;
BEGIN
  PERFORM 1 FROM promotion_scope WHERE id=NEW.scope_id FOR UPDATE;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['status','confirmed_by','confirmed_at','paid_amount_minor','paid_currency','statement_reference'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','confirmed_by','confirmed_at','paid_amount_minor','paid_currency','statement_reference']) THEN
      RAISE EXCEPTION 'promotion_identity_immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.confirmed_at IS NOT NULL AND
       (NEW.confirmed_by,NEW.confirmed_at,NEW.paid_amount_minor,NEW.paid_currency,NEW.statement_reference)
       IS DISTINCT FROM (OLD.confirmed_by,OLD.confirmed_at,OLD.paid_amount_minor,OLD.paid_currency,OLD.statement_reference) THEN
      RAISE EXCEPTION 'promotion_confirmation_immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status IN ('cancelled','completed') AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'promotion_closed' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.status NOT IN ('pending','active') THEN RETURN NEW; END IF;
  SELECT * INTO b FROM directory_business WHERE id=NEW.business_id;
  IF b.deleted_at IS NOT NULL OR b.status<>'published' OR b.owner_user_id<>NEW.owner_id OR
     NEW.scope_key IS DISTINCT FROM (CASE NEW.kind WHEN 'nearby' THEN lower(btrim(b.city)) WHEN 'category' THEN b.category_id::text ELSE '*' END) THEN
    RAISE EXCEPTION 'promotion_business_unavailable' USING ERRCODE='23514';
  END IF;
  cap:=CASE NEW.kind WHEN 'home' THEN 6 WHEN 'banner' THEN 1 ELSE 3 END;
  FOR point IN SELECT NEW.starts_at UNION SELECT starts_at FROM promotion_order
    WHERE scope_id=NEW.scope_id AND id<>NEW.id AND status IN ('pending','active')
      AND starts_at>NEW.starts_at AND starts_at<NEW.ends_at LOOP
    IF (SELECT count(*) FROM promotion_order WHERE scope_id=NEW.scope_id AND id<>NEW.id
        AND status IN ('pending','active') AND starts_at<=point AND ends_at>point)>=cap THEN
      RAISE EXCEPTION 'promotion_capacity_full' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_capacity BEFORE INSERT OR UPDATE ON promotion_order
  FOR EACH ROW EXECUTE FUNCTION guard_promotion_capacity();

CREATE FUNCTION guard_promotion_image() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM promotion_order WHERE id=NEW.order_id AND kind='banner') THEN
    RAISE EXCEPTION 'promotion_image_requires_banner' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_image_type BEFORE INSERT OR UPDATE ON promotion_banner_image
  FOR EACH ROW EXECUTE FUNCTION guard_promotion_image();

CREATE FUNCTION cancel_changed_promotions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='directory_business' THEN
    UPDATE promotion_order SET status='cancelled' WHERE business_id=NEW.id
      AND (status='pending' OR (status='active' AND ends_at>clock_timestamp()))
      AND (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.status<>'published' OR NEW.deleted_at IS NOT NULL
        OR (kind='nearby' AND scope_key IS DISTINCT FROM lower(btrim(NEW.city)))
        OR (kind='category' AND scope_key IS DISTINCT FROM NEW.category_id::text));
  ELSE
    IF NEW.approval<>'approved' OR NOT NEW."emailVerified" OR NEW.role NOT IN ('member','owner') THEN
      UPDATE promotion_order SET status='cancelled' WHERE owner_id=NEW.id
        AND (status='pending' OR (status='active' AND ends_at>clock_timestamp()));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promotion_business_changed AFTER UPDATE OF owner_user_id,category_id,city,status,deleted_at
 ON directory_business FOR EACH ROW WHEN (
 NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.category_id IS DISTINCT FROM OLD.category_id OR
 NEW.city IS DISTINCT FROM OLD.city OR NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
 EXECUTE FUNCTION cancel_changed_promotions();
CREATE TRIGGER promotion_owner_changed AFTER UPDATE OF approval,"emailVerified",role ON auth_user
 FOR EACH ROW WHEN (NEW.approval IS DISTINCT FROM OLD.approval OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified" OR NEW.role IS DISTINCT FROM OLD.role)
 EXECUTE FUNCTION cancel_changed_promotions();

-- Content erasure never reads or changes archived payment and advertisement rows.
CREATE OR REPLACE FUNCTION erase_account_content(subject_user text, previous_email text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id=subject_user AND erased_at IS NOT NULL) THEN
    RAISE EXCEPTION 'account_erasure_not_authorized' USING ERRCODE='23514';
  END IF;

  DELETE FROM auth_session WHERE "userId"=subject_user;
  DELETE FROM auth_account WHERE "userId"=subject_user;
  DELETE FROM auth_verification WHERE value=subject_user OR lower(identifier)=lower(previous_email);
  DELETE FROM auth_account_preferences WHERE user_id=subject_user;
  DELETE FROM account_approval_email WHERE user_id=subject_user;
  DELETE FROM push_device WHERE user_id=subject_user;
  DELETE FROM push_test_limit WHERE user_id=subject_user;
  DELETE FROM community_rules_acceptance WHERE account_id=subject_user;
  DELETE FROM personal_profile_image WHERE user_id=subject_user;
  DELETE FROM personal_profile WHERE user_id=subject_user;
  DELETE FROM people_block WHERE subject_user IN (actor_id,people_block.target_id);
  DELETE FROM people_connection_event
    WHERE connection_id IN (SELECT id FROM people_connection WHERE subject_user IN (left_user_id,right_user_id));
  DELETE FROM people_connection_command
    WHERE connection_id IN (SELECT id FROM people_connection WHERE subject_user IN (left_user_id,right_user_id));
  DELETE FROM people_connection WHERE subject_user IN (left_user_id,right_user_id);
  DELETE FROM business_favorite_command WHERE user_id=subject_user;
  DELETE FROM business_favorite WHERE user_id=subject_user;
  DELETE FROM directory_saved_search WHERE account_id=subject_user;
  DELETE FROM blog_bookmark WHERE account_id=subject_user;
  DELETE FROM account_activity WHERE recipient_id=subject_user;
  DELETE FROM support_request WHERE actor_id=subject_user;

  UPDATE message_message SET body='[Poruka obrisana]' WHERE sender_user_id=subject_user;
  DELETE FROM push_delivery WHERE message_id IN (SELECT id FROM message_message WHERE sender_user_id=subject_user);
  DELETE FROM business_review_event
    WHERE review_id IN (SELECT id FROM business_review WHERE author_user_id=subject_user);
  DELETE FROM business_review_command
    WHERE review_id IN (SELECT id FROM business_review WHERE author_user_id=subject_user);
  DELETE FROM business_review WHERE author_user_id=subject_user;

  UPDATE booking_entry SET client_name=NULL,client_email=NULL,client_phone=NULL
    WHERE customer_user_id=subject_user;
  UPDATE rental_booking SET customer_name='Obrisan nalog' WHERE customer_id=subject_user;
  UPDATE stay_booking SET customer_name='Obrisan nalog' WHERE customer_id=subject_user;

  DELETE FROM business_reel_like WHERE user_id=subject_user;
  DELETE FROM business_reel_part
    WHERE reel_id IN (SELECT id FROM business_reel WHERE submitted_by=subject_user);
  DELETE FROM business_reel WHERE submitted_by=subject_user;

  DELETE FROM directory_business_image_proposal
    WHERE business_id IN (SELECT id FROM directory_business WHERE owner_user_id=subject_user AND deleted_at IS NOT NULL);
  DELETE FROM directory_business_image
    WHERE business_id IN (SELECT id FROM directory_business WHERE owner_user_id=subject_user AND deleted_at IS NOT NULL);
  DELETE FROM directory_business_details
    WHERE business_id IN (SELECT id FROM directory_business WHERE owner_user_id=subject_user AND deleted_at IS NOT NULL);
  UPDATE directory_business SET title='Uklonjena djelatnost',description=NULL,contact_email=NULL,
    contact_phone=NULL,website_url=NULL,address_line=NULL,city=NULL,country_code=NULL,latitude=NULL,
    longitude=NULL,editorial_revision=NULL,is_verified=false,is_featured=false
    WHERE owner_user_id=subject_user AND deleted_at IS NOT NULL;
END $$;

