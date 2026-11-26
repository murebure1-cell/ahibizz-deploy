// The founder: the account marked founder when the administration was separated (migration
// 0059), or before that the account of the first successful owner bootstrap. Later owners
// cannot inherit the insignia. It is a role mark; verification stays a separate decision.
export const platformFounderJoin = `LEFT JOIN (
  SELECT target_user_id FROM auth_account_audit
  WHERE action='bootstrap-owner' AND actor_user_id=target_user_id
    AND previous_role='member' AND next_role='owner' AND next_approval='approved'
  ORDER BY created_at,id LIMIT 1
) founder ON founder.target_user_id=u.id AND u.approval='approved' AND u."emailVerified"`;

export const platformBadgeColumns = `u.profile_verified AS verified,
  (founder.target_user_id IS NOT NULL OR (u.founder AND u.approval='approved')) AS "platformFounder",
  (founder.target_user_id IS NOT NULL AND u.role='owner') AS "platformAdministrator"`;
