import { readAuthConfiguration } from "./auth";
import {
  AccountAccessError,
  type AccountService,
  getAccountService,
  parseAccountListInput,
} from "./auth/accounts";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

async function input(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountAccessError(400, "INVALID_REQUEST");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > 4096) {
        await reader.cancel();
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      }
      parts.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AccountAccessError(400, "INVALID_REQUEST");
  }
}

export function createAccountHttpHandler({
  service,
  baseURL,
}: {
  service: AccountService;
  baseURL: string;
}) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const target = /^\/api\/admin\/accounts\/([A-Za-z0-9_-]{1,128})$/.exec(pathname)?.[1];
      if (request.method === "GET") {
        if (pathname === "/api/account")
          return reply({ account: await service.read(request.headers) });
        if (pathname === "/api/admin/accounts") {
          if (!url.search) return reply(await service.listPending(request.headers));
          if (request.url.length > 8192) throw new AccountAccessError(400, "INVALID_ACCOUNT_QUERY");
          const seen = new Set<string>();
          for (const key of url.searchParams.keys()) {
            if (!["approval", "page", "q"].includes(key) || seen.has(key))
              throw new AccountAccessError(400, "UNEXPECTED_FIELD");
            seen.add(key);
          }
          const page = url.searchParams.get("page");
          if (!page || !/^[1-9][0-9]*$/.test(page))
            throw new AccountAccessError(400, "INVALID_ACCOUNT_QUERY");
          const query = parseAccountListInput({
            approval: url.searchParams.get("approval"),
            page: Number(page),
            ...(url.searchParams.has("q") ? { q: url.searchParams.get("q") } : {}),
          });
          return reply(await service.listAccounts(request.headers, query));
        }
      }
      if (request.method !== "PATCH" || (pathname !== "/api/account" && !target))
        return reply({ code: "NOT_FOUND" }, 404);
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const value = await input(request);
      return reply({
        account: target
          ? await service.decide(request.headers, target, value)
          : await service.update(request.headers, value),
      });
    } catch (error) {
      if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
      return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    }
  };
}

export async function handleAccountRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getAccountService();
    if (!configuration || !service) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    return createAccountHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  }
}
