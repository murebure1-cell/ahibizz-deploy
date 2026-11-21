import { createAccountBlocksService } from "./account-blocks";
import { AccountAccessError } from "./auth/accounts";
import { getAuthDatabasePool, getAuthService, readAuthConfiguration } from "./auth/service";
import { readFlatJson } from "./flat-json";

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function handleAccountBlocksRequest(request: Request) {
  try {
    const url = new URL(request.url);
    const target = /^\/api\/account\/blocks\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname)?.[1];
    const configuration = readAuthConfiguration(),
      auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!configuration || !auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    const service = createAccountBlocksService(auth, pool);
    if (request.method === "GET") {
      if (target && !url.search) return reply(await service.state(request.headers, target));
      if (url.pathname !== "/api/account/blocks") return reply({ code: "NOT_FOUND" }, 404);
      const page = url.searchParams.get("page");
      if (
        url.searchParams.size &&
        (url.searchParams.size !== 1 || !page || !/^[1-9]\d{0,3}$/.test(page) || +page > 1000)
      )
        return reply({ code: "INVALID_ACCOUNT_QUERY" }, 400);
      return reply(await service.list(request.headers, Number(page ?? 1)));
    }
    if (
      request.method !== "PATCH" ||
      (!target && url.pathname !== "/api/account/blocks") ||
      url.search
    )
      return reply({ code: "NOT_FOUND" }, 404);
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
    if (!target) {
      if (
        !payload ||
        typeof payload !== "object" ||
        !("hideInSearch" in payload) ||
        Object.keys(payload).length !== 1 ||
        typeof payload.hideInSearch !== "boolean"
      )
        return reply({ code: "INVALID_REQUEST" }, 400);
      return reply(await service.changeSearchFilter(request.headers, payload.hideInSearch));
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("blocked" in payload) ||
      !("expectedVersion" in payload) ||
      Object.keys(payload).length !== 2 ||
      typeof payload.blocked !== "boolean" ||
      typeof payload.expectedVersion !== "number" ||
      !Number.isInteger(payload.expectedVersion) ||
      payload.expectedVersion < 0 ||
      payload.expectedVersion > 2147483646
    )
      return reply({ code: "INVALID_REQUEST" }, 400);
    return reply(
      await service.set(request.headers, target, payload.blocked, payload.expectedVersion),
    );
  } catch (error) {
    if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
    return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  }
}
