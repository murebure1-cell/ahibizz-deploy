import { handleStayRequest } from "../../../../server/stays-http";
export const dynamic = "force-dynamic";
export const GET = handleStayRequest;
export const POST = guardedContribution(handleStayRequest);

import { guardedContribution } from "../../../../server/community-rules";
