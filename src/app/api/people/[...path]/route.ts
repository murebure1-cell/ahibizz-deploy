import { handlePeopleRequest } from "../../../../server/people-http";
export const dynamic = "force-dynamic";
export const GET = handlePeopleRequest;
export const PATCH = guardedContribution(handlePeopleRequest);
export const PUT = guardedContribution(handlePeopleRequest);
export const DELETE = handlePeopleRequest;

import { guardedContribution } from "../../../../server/community-rules";
