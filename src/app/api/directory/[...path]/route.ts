import { handleDirectoryRequest } from "../../../../server/directory-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleDirectoryRequest;
export const POST = guardedContribution(handleDirectoryRequest);
export const PATCH = guardedContribution(handleDirectoryRequest);
export const DELETE = guardedContribution(handleDirectoryRequest);

import { guardedContribution } from "../../../../server/community-rules";
