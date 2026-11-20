import { handleMessagingRequest } from "../../../../server/messaging-http";
export const dynamic = "force-dynamic";
export const GET = handleMessagingRequest;
export const POST = guardedContribution(handleMessagingRequest);

import { guardedContribution } from "../../../../server/community-rules";
