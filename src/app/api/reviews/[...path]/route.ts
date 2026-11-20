import { handleReviewsRequest } from "../../../../server/reviews-http";
export const dynamic = "force-dynamic";
export const GET = handleReviewsRequest;
export const PUT = guardedContribution(handleReviewsRequest);
export const POST = handleReviewsRequest;

import { guardedContribution } from "../../../../server/community-rules";
