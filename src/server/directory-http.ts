import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { DirectoryAccessError, type DirectoryService, getDirectoryService } from "./directory";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
function query(url: URL, allowed: string[]) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key))
      throw new DirectoryAccessError(400, "INVALID_DIRECTORY_INPUT");
    if (["page", "pageSize"].includes(key)) {
      if (!/^\d{1,3}$/.test(value)) throw new DirectoryAccessError(400, "INVALID_DIRECTORY_INPUT");
      result[key] = Number(value);
    } else result[key] = value;
  }
  return result;
}
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DirectoryAccessError(400, "INVALID_DIRECTORY_INPUT");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 16384) {
        await reader.cancel();
        throw new DirectoryAccessError(413, "REQUEST_TOO_LARGE");
      }
      parts.push(part.value);
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
    throw new DirectoryAccessError(400, "INVALID_DIRECTORY_INPUT");
  }
}

export function createDirectoryHttpHandler({
  service,
  baseURL,
}: {
  service: DirectoryService;
  baseURL: string;
}) {
  return async function directoryHttp(request: Request) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/directory/")) return reply({ code: "NOT_FOUND" }, 404);
      if (request.url.length > 8192) return reply({ code: "INVALID_DIRECTORY_INPUT" }, 400);
      const path = url.pathname.slice("/api/directory".length);
      const resource =
        /^\/(mine|businesses|review)\/([A-Za-z0-9-]{1,128})(?:\/(publish|archive|recover))?$/.exec(
          path,
        );
      const area = resource?.[1],
        id = resource?.[2],
        action = resource?.[3];
      if (request.method === "GET") {
        if (path === "/categories") {
          query(url, []);
          return reply(await service.categories());
        }
        if (path === "/businesses")
          return reply(
            await service.listPublic(
              query(url, ["q", "city", "page", "pageSize", "categoryId", "subcategoryId"]),
            ),
          );
        if (path === "/mine")
          return reply(
            await service.listOwn(request.headers, query(url, ["q", "page", "pageSize", "status"])),
          );
        if (path === "/review")
          return reply(await service.pending(request.headers, query(url, ["page", "pageSize"])));
        if (path === "/admin")
          return reply(
            await service.listAdmin(
              request.headers,
              query(url, ["q", "page", "pageSize", "status"]),
            ),
          );
        if (id && !action) {
          query(url, []);
          if (area === "businesses") return reply({ business: await service.readPublic(id) });
          if (area === "mine")
            return reply({ business: await service.readOwn(request.headers, id) });
        }
        return reply({ code: "NOT_FOUND" }, 404);
      }
      const create = request.method === "POST" && (path === "/mine" || path === "/categories");
      const change =
        request.method === "PATCH" && id && !action && (area === "mine" || area === "review");
      const move = request.method === "POST" && id && action && area === "mine";
      if (!create && !change && !move) return reply({ code: "NOT_FOUND" }, 404);
      query(url, []);
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const body = await input(request);
      if (create && path === "/categories")
        return reply({ category: await service.createCategory(request.headers, body) }, 201);
      if (create)
        return reply(
          {
            business: await service.create(
              request.headers,
              body,
              request.headers.get("idempotency-key") ?? "",
            ),
          },
          201,
        );
      if (!id) return reply({ code: "NOT_FOUND" }, 404);
      if (change)
        return reply({
          business:
            area === "review"
              ? await service.moderate(request.headers, id, body)
              : await service.update(request.headers, id, body),
        });
      if (action === "publish")
        return reply({ business: await service.publish(request.headers, id, body) });
      if (action === "archive")
        return reply({ business: await service.archive(request.headers, id, body) });
      if (action === "recover")
        return reply({ business: await service.recover(request.headers, id, body) });
      return reply({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof DirectoryAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "DIRECTORY_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleDirectoryRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getDirectoryService();
    if (!configuration || !service) return reply({ code: "DIRECTORY_UNAVAILABLE" }, 503);
    return createDirectoryHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "DIRECTORY_UNAVAILABLE" }, 503);
  }
}
