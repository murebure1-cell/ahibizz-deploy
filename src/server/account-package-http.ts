import {
  type AccountPackageService,
  getAccountPackageService,
  packageTarget,
} from "./account-package";
import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { readFlatJson } from "./flat-json";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export function createAccountPackageHttpHandler(service: AccountPackageService, baseURL: string) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      const id = /^\/api\/admin\/packages\/([^/]+)$/.exec(url.pathname)?.[1];
      if (!id || url.search || url.pathname.length > 200)
        return reply({ code: "INVALID_PACKAGE_INPUT" }, 400);
      const target = packageTarget(id);
      if (request.method === "GET") return reply(await service.read(request.headers, target));
      if (request.method !== "PUT") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const value = await readFlatJson(
        request,
        () => {
          throw new AccountAccessError(400, "INVALID_PACKAGE_INPUT");
        },
        () => {
          throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
        },
      );
      return reply(await service.decide(request.headers, target, value));
    } catch (error) {
      if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
      return reply({ code: "PACKAGE_UNAVAILABLE" }, 503);
    }
  };
}

export async function handleAccountPackageRequest(request: Request) {
  try {
    const service = getAccountPackageService(),
      configuration = readAuthConfiguration();
    if (service && configuration)
      return await createAccountPackageHttpHandler(service, configuration.baseURL)(request);
  } catch {
    /* Report configuration failures without exposing private configuration. */
  }
  return reply({ code: "PACKAGE_UNAVAILABLE" }, 503);
}
