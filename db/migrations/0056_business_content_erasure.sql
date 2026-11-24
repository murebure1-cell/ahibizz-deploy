-- When an owner deletes one business (without deleting the account), its own content is removed at
-- once: photos, details and Reels here; text, contact, address and location in the removal UPDATE. Records that belong to other people or
-- must be kept stay: bookings keep their own copy of the business name, other people's reviews and
-- messages stay with their authors, and payment records are not touched.
CREATE OR REPLACE FUNCTION erase_business_content(target uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM directory_business WHERE id=target AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'business_erasure_not_authorized' USING ERRCODE='23514';
  END IF;

  DELETE FROM business_reel_part WHERE reel_id IN (SELECT id FROM business_reel WHERE business_id=target);
  DELETE FROM business_reel_like WHERE reel_id IN (SELECT id FROM business_reel WHERE business_id=target);
  UPDATE business_reel SET status='withdrawn',has_poster=false
    WHERE business_id=target AND status IN ('uploading','pending','published','rejected');
  UPDATE business_reel SET has_poster=false WHERE business_id=target AND status IN ('expired','removed');

  DELETE FROM directory_business_image_proposal WHERE business_id=target;
  DELETE FROM directory_business_image WHERE business_id=target;
  DELETE FROM directory_business_details WHERE business_id=target;
  -- The listing's own text, contact and location are cleared by the same UPDATE that removes it;
  -- a removed row is protected by guard_removed_directory_business afterwards.
END $$;
