import { handleBusinessMediaRequest } from "../../../../server/business-media-http";
export const dynamic = "force-dynamic";
export const GET = handleBusinessMediaRequest;
export const PUT = guardedContribution(handleBusinessMediaRequest);
export const DELETE = handleBusinessMediaRequest;

import { guardedContribution } from "../../../../server/community-rules";
