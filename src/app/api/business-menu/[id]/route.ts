import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";
import { readOwnMenu, saveOwnMenu } from "../../../../server/business-menu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function failure(error: unknown) {
  return error instanceof AccountAccessError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "MENU_UNAVAILABLE" }, 503);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return reply({ code: "MENU_UNAVAILABLE" }, 503);
  try {
    return reply(await readOwnMenu(auth, pool, request.headers, (await params).id));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const configuration = readAuthConfiguration(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!configuration || !auth || !pool) return reply({ code: "MENU_UNAVAILABLE" }, 503);
  if (request.headers.get("origin") !== new URL(configuration.baseURL).origin)
    return reply({ code: "INVALID_ORIGIN" }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 64_000) return reply({ code: "INVALID_MENU" }, 400);
    body = JSON.parse(text);
  } catch {
    return reply({ code: "INVALID_MENU" }, 400);
  }
  try {
    return reply({ menu: await saveOwnMenu(auth, pool, request.headers, (await params).id, body) });
  } catch (error) {
    return failure(error);
  }
}
