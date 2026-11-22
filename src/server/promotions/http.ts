import { IS_PLAY_EDITION } from "../../lib/distribution";
import { AccountAccessError, readAuthConfiguration } from "../auth";
import { RasterImageError } from "../media/normalize-image";
import { getPublicPromotionImage } from "./read";
import { getPromotionsService, PromotionError, type PromotionsService } from "./service";

function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
async function bytes(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new PromotionError(400, "INVALID_PROMOTION");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new PromotionError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const value = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.length;
  }
  return value;
}
async function json(request: Request, maximum = 8192) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    throw new PromotionError(415, "INVALID_CONTENT_TYPE");
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await bytes(request, maximum)),
    ) as unknown;
  } catch (error) {
    if (error instanceof PromotionError) throw error;
    throw new PromotionError(400, "INVALID_PROMOTION");
  }
}
export function createPromotionsHttpHandler({
  service,
  baseURL,
  play = IS_PLAY_EDITION,
}: {
  service: PromotionsService;
  baseURL: string;
  play?: boolean;
}) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url),
        path = url.pathname;
      const image = path.match(/^\/api\/promotions\/([a-f0-9-]{36})\/image$/i);
      if (image && request.method === "GET") {
        const data = await service.image(request.headers, image[1] as string);
        return new Response(new Uint8Array(data), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "image/webp",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      }
      if (play) return reply({ code: "NOT_FOUND" }, 404);
      const admin = path.startsWith("/api/admin/promotions");
      if (request.method !== "GET" && request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        (path === "/api/promotions/availability" ||
          path === "/api/admin/promotions/availability") &&
        request.method === "GET"
      ) {
        if (
          url.searchParams.size !== 4 ||
          ["businessId", "kind", "durationDays", "startsAt"].some(
            (key) => url.searchParams.getAll(key).length !== 1,
          )
        )
          throw new PromotionError(400, "INVALID_PROMOTION");
        return reply(
          await service.availability(
            request.headers,
            {
              businessId: url.searchParams.get("businessId"),
              kind: url.searchParams.get("kind"),
              durationDays: Number(url.searchParams.get("durationDays")),
              startsAt: url.searchParams.get("startsAt"),
            },
            admin,
          ),
        );
      }
      if (url.search) return reply({ code: "NOT_FOUND" }, 404);
      if (
        (path === "/api/promotions" || path === "/api/admin/promotions") &&
        request.method === "GET"
      )
        return reply(await service.list(request.headers, admin));
      if (path === "/api/promotions" && request.method === "POST")
        return reply(await service.create(request.headers, await json(request)), 201);
      if (path === "/api/admin/promotions/manual" && request.method === "POST")
        return reply(
          await service.manual(request.headers, await json(request, 6 * 1024 * 1024)),
          201,
        );
      if (path === "/api/admin/promotions/prices" && request.method === "PUT")
        return reply(await service.prices(request.headers, await json(request)));
      const action = path.match(
        /^\/api\/(admin\/)?promotions\/([a-f0-9-]{36})\/(cancel|confirm)$/i,
      );
      if (action && request.method === "POST") {
        const input = await json(request);
        if (action[3] === "confirm" && admin)
          return reply(await service.confirm(request.headers, action[2] as string, input));
        if (action[3] === "cancel") {
          if (
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            Object.keys(input).length
          )
            throw new PromotionError(400, "INVALID_PROMOTION");
          return reply(await service.cancel(request.headers, action[2] as string, admin));
        }
      }
      if (image && request.method === "PUT") {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(
            request.headers.get("content-type") ?? "",
          )
        )
          return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
        return reply(
          await service.saveImage(
            request.headers,
            image[1] as string,
            await bytes(request, 4 * 1024 * 1024),
          ),
        );
      }
      return reply({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof PromotionError)
        return reply(
          {
            code: error.code,
            ...(error.firstAvailableAt ? { firstAvailableAt: error.firstAvailableAt } : {}),
          },
          error.status,
        );
      if (error instanceof AccountAccessError || error instanceof RasterImageError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "PROMOTIONS_UNAVAILABLE" }, 503);
    }
  };
}
export async function handlePromotionsRequest(request: Request) {
  const publicImage = new URL(request.url).pathname.match(
    /^\/api\/promotions\/([a-f0-9-]{36})\/image$/i,
  );
  if (publicImage && request.method === "GET") {
    try {
      const bytes = await getPublicPromotionImage(publicImage[1] as string);
      if (bytes)
        return new Response(new Uint8Array(bytes), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "image/webp",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
    } catch {
      return reply({ code: "PROMOTIONS_UNAVAILABLE" }, 503);
    }
  }
  // Play must return 404 even when no auth/database configuration is installed.
  if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    const config = readAuthConfiguration(),
      service = getPromotionsService();
    if (!config || !service) return reply({ code: "PROMOTIONS_UNAVAILABLE" }, 503);
    return createPromotionsHttpHandler({ service, baseURL: config.baseURL })(request);
  } catch {
    return reply({ code: "PROMOTIONS_UNAVAILABLE" }, 503);
  }
}
