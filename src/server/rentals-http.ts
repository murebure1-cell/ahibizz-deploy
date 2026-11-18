import { readAuthConfiguration } from "./auth";
import { createInventoryHttpHandler } from "./inventory-http";
import { getRentalService, type RentalService } from "./rentals/service";

export function createRentalHttpHandler(service: RentalService, baseURL: string) {
  return createInventoryHttpHandler(service, baseURL, {
    prefix: "/api/rentals/",
    invalidCode: "INVALID_RENTAL_INPUT",
    unavailableCode: "RENTAL_UNAVAILABLE",
    save: async (h, id, input) => ({ vehicle: await service.saveVehicle(h, id, input) }),
    archive: (h, id, resource, input) => service.archiveVehicle(h, id, resource, input),
  });
}

export async function handleRentalRequest(request: Request) {
  try {
    const service = getRentalService(),
      configuration = readAuthConfiguration();
    if (service && configuration)
      return createRentalHttpHandler(service, configuration.baseURL)(request);
  } catch {}
  return Response.json(
    { code: "RENTAL_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
