import { handleBookingRequest } from "../../../../server/booking-http";
export const dynamic = "force-dynamic";
export const GET = handleBookingRequest;
export const POST = handleBookingRequest;
export const PATCH = guardedContribution(handleBookingRequest);

import { guardedContribution } from "../../../../server/community-rules";
