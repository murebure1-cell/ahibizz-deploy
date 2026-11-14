import { handleDirectoryRequest } from "../../../../server/directory-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleDirectoryRequest;
export const POST = handleDirectoryRequest;
export const PATCH = handleDirectoryRequest;
