import { handleAccountBadgesRequest } from "../../../../server/account-badges-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAccountBadgesRequest;
export const POST = handleAccountBadgesRequest;
