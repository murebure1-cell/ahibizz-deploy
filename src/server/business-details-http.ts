import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { type DirectoryService, getDirectoryService } from "./directory/service";
import { DirectoryAccessError } from "./directory/types";

const noCache = { "Cache-Control": "no-store", Pragma: "no-cache" };
function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: noCache });
}
const path =
  /^\/api\/business-details\/mine\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;
async function input(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new DirectoryAccessError(400, "INVALID_BUSINESS_DETAILS");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) {
        await reader.cancel();
        throw new DirectoryAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DirectoryAccessError(400, "INVALID_BUSINESS_DETAILS");
  }
}
export function createBusinessDetailsHttpHandler({
  service,
  baseURL,
}: {
  service: Pick<DirectoryService, "readDetails" | "updateDetails">;
  baseURL: string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 8192) return reply({ code: "INVALID_BUSINESS_DETAILS" }, 400);
      const url = new URL(request.url),
        match = path.exec(url.pathname);
      if (!match || !["GET", "PUT"].includes(request.method))
        return reply({ code: "NOT_FOUND" }, 404);
      if (url.search || url.hash) return reply({ code: "INVALID_BUSINESS_DETAILS" }, 400);
      const origin = new URL(baseURL).origin;
      const sameOrigin =
        request.headers.get("origin") === origin ||
        (request.method === "GET" &&
          request.headers.get("origin") === null &&
          request.headers.get("sec-fetch-site") === "same-origin");
      if (!sameOrigin) return reply({ code: "INVALID_ORIGIN" }, 403);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(request.headers.get("X-AhiBizz-Account-ID") ?? ""))
        return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
      const id = (match[1] as string).toLowerCase();
      if (request.method === "GET")
        return reply({ business: await service.readDetails(request.headers, id) });
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      // Authenticate before consuming untrusted input. The transaction repeats authority/session checks.
      await service.readDetails(request.headers, id);
      return reply({
        business: await service.updateDetails(request.headers, id, await input(request)),
      });
    } catch (error) {
      if (error instanceof DirectoryAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "DIRECTORY_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleBusinessDetailsRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getDirectoryService();
    if (!configuration || !service) return reply({ code: "DIRECTORY_UNAVAILABLE" }, 503);
    return createBusinessDetailsHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "DIRECTORY_UNAVAILABLE" }, 503);
  }
}
