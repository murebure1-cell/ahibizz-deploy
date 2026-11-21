import { readAccountJson } from "../../../../server/account-http";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { readSavedSearches } from "../../../../server/saved-search";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const failure = (error: unknown) =>
  error instanceof AccountAccessError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "SEARCHES_UNAVAILABLE" }, 503);
export async function GET(request: Request) {
  try {
    return reply(await readSavedSearches(request.headers));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const config = readAuthConfiguration();
    if (!config || request.headers.get("origin") !== new URL(config.baseURL).origin)
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    return reply(await readSavedSearches(request.headers, await readAccountJson(request)));
  } catch (error) {
    return failure(error);
  }
}
