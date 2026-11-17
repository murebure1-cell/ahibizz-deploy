import { readFavoriteStates } from "../lib/favorites";
import { AccountAccessError, readAuthConfiguration } from "./auth";
import {
  FavoritesAccessError,
  type FavoritesService,
  favoriteCommand,
  getFavoritesService,
} from "./favorites/service";

function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
function invalid(): never {
  throw new FavoritesAccessError(400, "INVALID_FAVORITE_INPUT");
}
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new FavoritesAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      value: unknown = JSON.parse(text);
    const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map(
      (match) => JSON.parse(`"${match[1]}"`) as string,
    );
    if (keys.length !== 3 || new Set(keys).size !== keys.length) invalid();
    return favoriteCommand(value);
  } catch (error) {
    if (error instanceof FavoritesAccessError) throw error;
    invalid();
  }
}
export function createFavoritesHttpHandler({
  service,
  baseURL,
}: {
  service: FavoritesService;
  baseURL: string;
}) {
  return async (request: Request) => {
    try {
      if (request.url.length > 8192) invalid();
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/favorites/states") {
        if (url.searchParams.size !== 1 || url.searchParams.getAll("ids").length !== 1) invalid();
        return reply(
          readFavoriteStates(
            await service.states(request.headers, (url.searchParams.get("ids") ?? "").split(",")),
          ),
        );
      }
      if (request.method === "GET" && url.pathname === "/api/favorites") {
        if (
          url.searchParams.size > 1 ||
          (url.search &&
            (url.searchParams.getAll("page").length !== 1 ||
              !/^[1-9]\d{0,3}$/.test(url.searchParams.get("page") ?? "")))
        )
          invalid();
        return reply(
          await service.list(request.headers, Number(url.searchParams.get("page") ?? "1")),
        );
      }
      const match = /^\/api\/favorites\/businesses\/([a-f0-9-]{36})$/i.exec(url.pathname);
      if (!match || request.method !== "PUT") return reply({ code: "NOT_FOUND" }, 404);
      if (url.search) invalid();
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      return reply(
        readFavoriteStates(
          await service.set(request.headers, match[1] as string, await input(request)),
        ),
      );
    } catch (error) {
      if (error instanceof FavoritesAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "FAVORITES_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleFavoritesRequest(request: Request) {
  try {
    const config = readAuthConfiguration(),
      service = getFavoritesService();
    if (!config || !service) return reply({ code: "FAVORITES_UNAVAILABLE" }, 503);
    return createFavoritesHttpHandler({ service, baseURL: config.baseURL })(request);
  } catch {
    return reply({ code: "FAVORITES_UNAVAILABLE" }, 503);
  }
}
