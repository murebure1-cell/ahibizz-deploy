import { handleAccountBlocksRequest } from "../../../../../server/account-blocks-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAccountBlocksRequest;
export const PATCH = handleAccountBlocksRequest;
