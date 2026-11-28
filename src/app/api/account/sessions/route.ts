import { handleAccountSessionsRequest } from "../../../../server/account-sessions-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAccountSessionsRequest;
export const POST = handleAccountSessionsRequest;
