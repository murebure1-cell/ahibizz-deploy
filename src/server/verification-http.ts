import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { readFlatJson } from "./flat-json";
import {
  type createVerificationService,
  getVerificationService,
  verificationTarget,
} from "./verification";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export function createVerificationHttpHandler(
  service: ReturnType<typeof createVerificationService>,
  baseURL: string,
) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      const parts = /^\/api\/admin\/verification\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!parts?.[1] || !parts[2] || url.search || url.pathname.length > 240)
        return reply({ code: "INVALID_VERIFICATION_INPUT" }, 400);
      const target = verificationTarget(parts[1], parts[2]);
      if (request.method === "GET")
        return reply(await service.read(request.headers, target.kind, target.id));
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
          throw new AccountAccessError(400, "INVALID_VERIFICATION_INPUT");
        },
        () => {
          throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
        },
      );
      return reply(await service.decide(request.headers, target.kind, target.id, value));
    } catch (error) {
      if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
      return reply({ code: "VERIFICATION_UNAVAILABLE" }, 503);
    }
  };
}

export async function handleVerificationRequest(request: Request) {
  try {
    const service = getVerificationService(),
      configuration = readAuthConfiguration();
    if (service && configuration)
      return await createVerificationHttpHandler(service, configuration.baseURL)(request);
  } catch {
    /* Report configuration failures without exposing private configuration. */
  }
  return reply({ code: "VERIFICATION_UNAVAILABLE" }, 503);
}
