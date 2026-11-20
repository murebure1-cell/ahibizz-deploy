import { handleBusinessDetailsRequest } from "../../../../server/business-details-http";
export const dynamic = "force-dynamic";
export const GET = handleBusinessDetailsRequest;
export const PUT = guardedContribution(handleBusinessDetailsRequest);

import { guardedContribution } from "../../../../server/community-rules";
