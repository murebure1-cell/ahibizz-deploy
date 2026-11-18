// The first successful bootstrap records the founding account. Later owners cannot inherit its insignia.
export const platformFounderJoin = `LEFT JOIN (
  SELECT target_user_id FROM auth_account_audit
  WHERE action='bootstrap-owner' AND actor_user_id=target_user_id
    AND previous_role='member' AND next_role='owner' AND next_approval='approved'
  ORDER BY created_at,id LIMIT 1
) founder ON founder.target_user_id=u.id AND u.profile_verified
  AND u.approval='approved' AND u."emailVerified"`;

export const platformBadgeColumns = `u.profile_verified AS verified,
  founder.target_user_id IS NOT NULL AS "platformFounder",
  (founder.target_user_id IS NOT NULL AND u.role='owner') AS "platformAdministrator"`;
