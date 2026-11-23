// Author eligibility is independent of personal-profile visibility. Private people remain anonymous.
export const reviewAuthorEligibility = `a.approval='approved' AND a."emailVerified"=true AND a.role IN ('member','owner')`;
export const reviewBusinessEligibility = `b.status='published' AND o.approval='approved' AND o."emailVerified"=true AND o.role IN ('member','owner')`;
export const reviewVisibility = `NOT r.withdrawn AND NOT r.hidden AND r.author_user_id<>b.owner_user_id AND ${reviewAuthorEligibility}`;
/** Trusted internal SQL alias only. DTO is reviews:{count:number,sum:number}, average=sum/count iff count>0. */
export function businessReviewsProjection(alias = "b"): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("invalid_sql_alias");
  return `(SELECT json_build_object('count',count(*)::integer,'sum',COALESCE(sum(r.rating),0)::integer) FROM business_review r JOIN auth_user a ON a.id=r.author_user_id WHERE r.business_id=${alias}.id AND NOT r.withdrawn AND NOT r.hidden AND r.author_user_id<>${alias}.owner_user_id AND ${reviewAuthorEligibility}) AS reviews`;
}
