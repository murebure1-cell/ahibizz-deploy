-- Keep identity and snapshots referenced by bookings, purchases and the first-year allowance.
ALTER TABLE directory_business
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by text REFERENCES auth_user(id) ON DELETE RESTRICT,
  ADD CONSTRAINT directory_removal_record CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND status='archived')
  );

-- A removed listing cannot be brought back by recovery or an older write path.
CREATE FUNCTION guard_removed_directory_business() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'removed_directory_business' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_removed_directory_business BEFORE UPDATE ON directory_business
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL) EXECUTE FUNCTION guard_removed_directory_business();
