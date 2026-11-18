import { readAuthConfiguration } from "./auth";
import { createInventoryHttpHandler } from "./inventory-http";
import { getStayService, type StayService } from "./stays/service";

export function createStayHttpHandler(service: StayService, baseURL: string) {
  return createInventoryHttpHandler(service, baseURL, {
    prefix: "/api/stays/",
    invalidCode: "INVALID_STAY_INPUT",
    unavailableCode: "STAY_UNAVAILABLE",
    save: async (h, id, input) => ({ unit: await service.saveUnit(h, id, input) }),
    archive: (h, id, resource, input) => service.archiveUnit(h, id, resource, input),
  });
}

export async function handleStayRequest(request: Request) {
  try {
    const service = getStayService(),
      configuration = readAuthConfiguration();
    if (service && configuration)
      return createStayHttpHandler(service, configuration.baseURL)(request);
  } catch {}
  return Response.json(
    { code: "STAY_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
