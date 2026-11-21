// Both private and public profile queries alias the account as u.
export const canCustomizeCoverSql = `(u.role='owner'
  OR EXISTS (
    SELECT 1 FROM personal_profile_entitlement e
    WHERE e.user_id=u.id AND e.can_customize_cover
  )
  OR EXISTS (
    SELECT 1 FROM directory_business b
    WHERE b.owner_user_id=u.id AND b.deleted_at IS NULL AND b.status<>'archived'
      AND paid_package_placement(b,'listing')
  ))`;
