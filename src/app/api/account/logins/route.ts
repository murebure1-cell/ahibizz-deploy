import { handleAccountLoginsRequest } from "../../../../server/account-logins-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleAccountLoginsRequest;
export const POST = handleAccountLoginsRequest;
