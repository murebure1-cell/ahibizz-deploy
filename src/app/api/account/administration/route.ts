import { AccountAccessError } from "../../../../server/auth/accounts";
import {
  createAdministration,
  handOverAdministration,
  readAdministration,
  renewAdministrationLink,
} from "../../../../server/auth/administration";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  return error instanceof AccountAccessError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
}

/** Where the separate administration stands; owner accounts only. */
export async function GET(request: Request) {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  try {
    return reply(await readAdministration(auth, pool, request.headers));
  } catch (error) {
    return failure(error);
  }
}

/** { "action": "create" | "link" | "hand-over" }. */
export async function POST(request: Request) {
  const configuration = readAuthConfiguration(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!configuration || !auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  if (request.headers.get("origin") !== new URL(configuration.baseURL).origin)
    return reply({ code: "INVALID_ORIGIN" }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
  let action: unknown;
  try {
    const text = await request.text();
    if (text.length > 256) return reply({ code: "INVALID_REQUEST" }, 400);
    const body = JSON.parse(text);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).join() !== "action"
    )
      return reply({ code: "UNEXPECTED_FIELD" }, 400);
    action = body.action;
  } catch {
    return reply({ code: "INVALID_REQUEST" }, 400);
  }
  try {
    if (action === "create")
      return reply(await createAdministration(auth, pool, request.headers, configuration.baseURL));
    if (action === "link")
      return reply(
        await renewAdministrationLink(auth, pool, request.headers, configuration.baseURL),
      );
    if (action === "hand-over")
      return reply(await handOverAdministration(auth, pool, request.headers));
    return reply({ code: "INVALID_ACTION" }, 400);
  } catch (error) {
    return failure(error);
  }
}
