import { handleRentalRequest } from "../../../../server/rentals-http";
export const dynamic = "force-dynamic";
export const GET = handleRentalRequest;
export const POST = guardedContribution(handleRentalRequest);

import { guardedContribution } from "../../../../server/community-rules";
