-- Closed account identities keep a non-authenticating key for historical receipts and audit.
ALTER TABLE auth_user
  ADD COLUMN erased_at timestamptz,
  ADD CONSTRAINT erased_account_identity CHECK (
    erased_at IS NULL OR (
      role='member' AND approval='suspended' AND NOT "emailVerified"
      AND NOT profile_verified AND image IS NULL AND name='Obrisan nalog'
      AND email ~ '^erased-[a-f0-9-]{36}@ahibizz[.]invalid$'
    )
  );

CREATE TABLE account_erasure_receipt (
  request_id uuid PRIMARY KEY,
  account_id text NOT NULL UNIQUE REFERENCES auth_user(id) ON DELETE RESTRICT,
  processed_by text NOT NULL REFERENCES auth_user(id) ON DELETE RESTRICT,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (account_id<>processed_by)
);

CREATE FUNCTION protect_erased_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'erased_account_immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_erased_account
  BEFORE UPDATE ON auth_user FOR EACH ROW WHEN (OLD.erased_at IS NOT NULL)
  EXECUTE FUNCTION protect_erased_account();
CREATE TRIGGER protect_erasure_receipt
  BEFORE UPDATE OR DELETE ON account_erasure_receipt FOR EACH ROW
  EXECUTE FUNCTION protect_erased_account();

-- Allow a fixed redaction of messages sent by an erased identity, while keeping participants,
-- sequence, dates, recipient messages and ordinary history immutability.
CREATE OR REPLACE FUNCTION message_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='message_message' AND TG_OP='UPDATE' THEN
    IF NEW.body='[Poruka obrisana]' AND
       (to_jsonb(NEW)-'body')=(to_jsonb(OLD)-'body') AND
       EXISTS(SELECT 1 FROM auth_user WHERE id=OLD.sender_user_id AND erased_at IS NOT NULL)
    THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'message_history_is_immutable' USING ERRCODE='23514';
END $$;

-- Removal still cannot be reversed. A previously removed listing may only be stripped of
-- content for its erased owner. Billing receipts can still refer to that listing ID.
CREATE OR REPLACE FUNCTION guard_removed_directory_business() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE content_fields text[] := ARRAY[
  'title','description','contact_email','contact_phone','website_url','address_line',
  'city','country_code','latitude','longitude','editorial_revision','is_verified','is_featured'
];
BEGIN
  IF NEW.title='Uklonjena djelatnost' AND NEW.description IS NULL AND
     NEW.contact_email IS NULL AND NEW.contact_phone IS NULL AND NEW.website_url IS NULL AND
     NEW.address_line IS NULL AND NEW.city IS NULL AND NEW.country_code IS NULL AND
     NEW.latitude IS NULL AND NEW.longitude IS NULL AND NEW.editorial_revision IS NULL AND
     NOT NEW.is_verified AND NOT NEW.is_featured AND
     (to_jsonb(NEW)-content_fields)=(to_jsonb(OLD)-content_fields) AND
     EXISTS(SELECT 1 FROM auth_user WHERE id=OLD.owner_user_id AND erased_at IS NOT NULL)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'removed_directory_business' USING ERRCODE='23514';
END $$;

CREATE FUNCTION erase_account_content(subject_user text, previous_email text) RETURNS void
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
  DELETE FROM personal_profile_entitlement WHERE user_id=subject_user;
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
  DELETE FROM ad_audience_preference WHERE account_id=subject_user;
  DELETE FROM ad_measurement_consent WHERE account_id=subject_user;
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
  DELETE FROM business_reel WHERE submitted_by=subject_user AND wallet_payment_id IS NULL;
  UPDATE business_reel SET title='Uklonjen video',caption='',status='withdrawn',has_poster=false,
    review_reason=NULL WHERE submitted_by=subject_user AND wallet_payment_id IS NOT NULL;

  UPDATE marketing_order SET status='closed',instructions=CASE
    WHEN instructions IS NOT NULL THEN 'Ponuda je zatvorena.' ELSE NULL END
    WHERE account_id=subject_user AND status IN ('requested','quoted');
  DELETE FROM marketing_ad_asset
    WHERE order_id IN (SELECT id FROM marketing_order WHERE account_id=subject_user);

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
