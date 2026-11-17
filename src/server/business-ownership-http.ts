import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import {
  type BusinessOwnershipService,
  getBusinessOwnershipService,
  OwnershipAccessError,
} from "./business-ownership";
import { commandInput, fail, lookupInput, uuid } from "./business-ownership/validation";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
function duplicateKeys(text: string) {
  const seen = new Set<string>();
  let depth = 0,
    keyExpected = false;
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (c === '"') {
      const start = index;
      while (++index < text.length) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      if (depth === 1 && keyExpected) {
        const key = JSON.parse(text.slice(start, index + 1)) as string;
        if (seen.has(key)) return true;
        seen.add(key);
        keyExpected = false;
      }
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) keyExpected = true;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) keyExpected = true;
  }
  return false;
}
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "INVALID_OWNERSHIP_INPUT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        fail(413, "REQUEST_TOO_LARGE");
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
    if (duplicateKeys(text)) fail(400, "INVALID_OWNERSHIP_INPUT");
    return value;
  } catch (error) {
    if (error instanceof OwnershipAccessError) throw error;
    fail(400, "INVALID_OWNERSHIP_INPUT");
  }
}
export function createBusinessOwnershipHttpHandler({
  service,
  baseURL,
}: {
  service: BusinessOwnershipService;
  baseURL: string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 2048) fail(400, "INVALID_OWNERSHIP_INPUT");
      const url = new URL(request.url),
        match =
          /^\/api\/directory\/ownership\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(\/lookup)?$/i.exec(
            url.pathname,
          );
      if (!match) return reply({ code: "NOT_FOUND" }, 404);
      const id = uuid(match[1]);
      if (request.method === "GET" && !match[2]) {
        if (
          [...url.searchParams.keys()].some((key) => key !== "requestId") ||
          url.searchParams.getAll("requestId").length > 1
        )
          fail(400, "INVALID_OWNERSHIP_INPUT");
        const key = url.searchParams.has("requestId")
          ? uuid(url.searchParams.get("requestId"))
          : undefined;
        return reply(await service.read(request.headers, id, key));
      }
      if (!((request.method === "POST" && match[2]) || (request.method === "PUT" && !match[2])))
        return reply({ code: "NOT_FOUND" }, 404);
      if (url.search) fail(400, "INVALID_OWNERSHIP_INPUT");
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      await service.authenticate(request.headers);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const value = await input(request);
      if (match[2])
        return reply(await service.lookup(request.headers, id, { email: lookupInput(value) }));
      return reply(await service.assign(request.headers, id, commandInput(value)));
    } catch (error) {
      if (error instanceof OwnershipAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "OWNERSHIP_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleBusinessOwnershipRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getBusinessOwnershipService();
    if (!configuration || !service) return reply({ code: "OWNERSHIP_UNAVAILABLE" }, 503);
    return createBusinessOwnershipHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "OWNERSHIP_UNAVAILABLE" }, 503);
  }
}
