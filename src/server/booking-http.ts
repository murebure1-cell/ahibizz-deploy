import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { BookingAccessError, type BookingService, getBookingService } from "./booking";

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
      throw new BookingAccessError(400, "INVALID_BOOKING_INPUT");
    if (key === "page") {
      if (!/^\d{1,3}$/.test(value)) throw new BookingAccessError(400, "INVALID_BOOKING_INPUT");
      result[key] = Number(value);
    } else result[key] = value;
  }
  return result;
}
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new BookingAccessError(400, "INVALID_BOOKING_INPUT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new BookingAccessError(413, "REQUEST_TOO_LARGE");
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
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BookingAccessError(400, "INVALID_BOOKING_INPUT");
  }
}
export function createBookingHttpHandler({
  service,
  baseURL,
}: {
  service: BookingService;
  baseURL: string;
}) {
  return async function bookingHttp(request: Request) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/booking/")) return reply({ code: "NOT_FOUND" }, 404);
      if (request.url.length > 8192) return reply({ code: "INVALID_BOOKING_INPUT" }, 400);
      const path = url.pathname.slice("/api/booking".length);
      const publicMatch = /^\/businesses\/([A-Za-z0-9-]{1,128})(?:\/(slots|requests))?$/.exec(path);
      const ownerMatch =
        /^\/mine\/businesses\/([A-Za-z0-9-]{1,128})\/(settings|calendar|entries)$/.exec(path);
      const entryMatch = /^\/entries\/([A-Za-z0-9-]{1,128})\/action$/.exec(path);
      if (request.method === "GET") {
        if (path === "/mine")
          return reply(await service.listMine(request.headers, query(url, ["page"])));
        if (publicMatch && !publicMatch[2]) {
          query(url, []);
          return reply({ booking: await service.publicConfig(publicMatch[1] as string) });
        }
        if (publicMatch?.[2] === "slots")
          return reply(
            await service.slots(publicMatch[1] as string, query(url, ["serviceId", "date"])),
          );
        if (ownerMatch?.[2] === "settings") {
          query(url, []);
          return reply({
            settings: await service.readSettings(request.headers, ownerMatch[1] as string),
          });
        }
        if (ownerMatch?.[2] === "calendar")
          return reply(
            await service.calendar(
              request.headers,
              ownerMatch[1] as string,
              query(url, ["from", "to"]),
            ),
          );
        return reply({ code: "NOT_FOUND" }, 404);
      }
      const save = request.method === "PATCH" && ownerMatch?.[2] === "settings";
      const create =
        request.method === "POST" &&
        (publicMatch?.[2] === "requests" || ownerMatch?.[2] === "entries");
      const move = request.method === "POST" && entryMatch;
      if (!save && !create && !move) return reply({ code: "NOT_FOUND" }, 404);
      query(url, []);
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const body = await input(request),
        key = request.headers.get("idempotency-key") ?? "";
      if (save && ownerMatch)
        return reply({
          settings: await service.saveSettings(request.headers, ownerMatch[1] as string, body),
        });
      if (create && publicMatch)
        return reply(
          {
            entry: await service.createRequest(
              request.headers,
              publicMatch[1] as string,
              body,
              key,
            ),
          },
          201,
        );
      if (create && ownerMatch)
        return reply(
          {
            entry: await service.createManual(request.headers, ownerMatch[1] as string, body, key),
          },
          201,
        );
      if (move && entryMatch)
        return reply({
          entry: await service.transition(request.headers, entryMatch[1] as string, body),
        });
      return reply({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof BookingAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "BOOKING_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleBookingRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getBookingService();
    if (!configuration || !service) return reply({ code: "BOOKING_UNAVAILABLE" }, 503);
    return createBookingHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "BOOKING_UNAVAILABLE" }, 503);
  }
}
