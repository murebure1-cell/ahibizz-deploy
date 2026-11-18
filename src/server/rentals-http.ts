import { AccountAccessError, readAuthConfiguration } from "./auth";
import { readFlatJson } from "./flat-json";
import { getRentalService, type RentalService } from "./rentals/service";

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function invalid(): never {
  throw new AccountAccessError(400, "INVALID_RENTAL_INPUT");
}

function calendarRange(query: URLSearchParams) {
  const from = query.get("from");
  const to = query.get("to");
  if (!from || !to || query.size !== 2) invalid();
  return { from, to };
}

export function createRentalHttpHandler(service: RentalService, baseURL: string) {
  const origin = new URL(baseURL).origin;
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      const prefix = "/api/rentals/";
      if (!url.pathname.startsWith(prefix)) return reply({ code: "NOT_FOUND" }, 404);
      if (url.href.length > 4096) invalid();
      const parts = url.pathname.slice(prefix.length).split("/");
      const [area, businessId, resourceId, calendar] = parts;
      const headers = request.headers;
      if (parts.slice(1).some((part) => !/^[a-zA-Z0-9-]{1,128}$/.test(part)))
        return reply({ code: "NOT_FOUND" }, 404);
      if (
        request.method === "GET" &&
        businessId &&
        resourceId &&
        (calendar === "calendar" || calendar === "availability") &&
        parts.length === 4 &&
        (area === "public" || area === "owner")
      ) {
        const { from, to } = calendarRange(url.searchParams);
        if (calendar === "availability")
          return reply({
            available: await service.available(
              businessId,
              resourceId,
              from,
              to,
              area === "owner" ? headers : undefined,
            ),
          });
        const entries =
          area === "public"
            ? await service.calendar(businessId, resourceId, from, to)
            : await service.ownerCalendar(headers, businessId, resourceId, from, to);
        return reply({ entries });
      }
      if (url.searchParams.size) invalid();
      if (request.method === "GET") {
        if (area === "mine" && parts.length === 1)
          return reply({ entries: await service.myBookings(headers) });
        if (businessId && parts.length === 2) {
          if (area === "owner") return reply(await service.ownerCatalog(headers, businessId));
          if (area === "public") return reply(await service.publicCatalog(businessId));
        }
        return reply({ code: "NOT_FOUND" }, 404);
      }
      if (
        request.method !== "POST" ||
        !businessId ||
        !(
          (area === "owner" && parts.length === 2) ||
          (["block", "request", "decide", "archive"].includes(area ?? "") && parts.length === 3)
        )
      )
        return reply({ code: "NOT_FOUND" }, 404);
      if (headers.get("origin") !== origin) return reply({ code: "INVALID_ORIGIN" }, 403);
      if (headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const input = await readFlatJson(request, invalid, () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      });
      if (area === "owner")
        return reply({ vehicle: await service.saveVehicle(headers, businessId, input) });
      if (!resourceId) invalid();
      if (area === "archive")
        return reply(await service.archiveVehicle(headers, businessId, resourceId, input));
      if (area === "block")
        return reply({ entry: await service.block(headers, businessId, resourceId, input) }, 201);
      if (area === "request")
        return reply({ entry: await service.request(headers, businessId, resourceId, input) }, 201);
      return reply({ entry: await service.decide(headers, businessId, resourceId, input) });
    } catch (error) {
      if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
      return reply({ code: "RENTAL_UNAVAILABLE" }, 503);
    }
  };
}

export async function handleRentalRequest(request: Request) {
  try {
    const service = getRentalService();
    const configuration = readAuthConfiguration();
    if (service && configuration)
      return createRentalHttpHandler(service, configuration.baseURL)(request);
  } catch {}
  return reply({ code: "RENTAL_UNAVAILABLE" }, 503);
}
