import { handleReviewRepliesRequest } from "../../../../server/review-replies-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleReviewRepliesRequest;
export const POST = handleReviewRepliesRequest;
