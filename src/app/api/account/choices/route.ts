import { createAccountChoicesService } from "../../../../server/account-choices";
import { AccountAccessError } from "../../../../server/auth/accounts";
import {
  getAuthDatabasePool,
  getAuthService,
  readAuthConfiguration,
} from "../../../../server/auth/service";
import { readFlatJson } from "../../../../server/flat-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function handle(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!configuration || !auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    if (new URL(request.url).search) return reply({ code: "INVALID_ACCOUNT_QUERY" }, 400);
    const service = createAccountChoicesService(auth, pool);
    if (request.method === "GET") return reply(await service.read(request.headers));
    if (request.headers.get("origin") !== new URL(configuration.baseURL).origin)
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    const payload = await readFlatJson(
      request,
      () => {
        throw new AccountAccessError(400, "INVALID_REQUEST");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    );
    return reply(await service.change(request.headers, payload));
  } catch (error) {
    if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
    return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  }
}
export const GET = handle;
export const PATCH = handle;
