export class DodoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export interface DodoTestHttpService {
  catalog(): unknown;
  create(headers: Headers, input: { requestId: string; businessId: string }): Promise<unknown>;
  read(headers: Headers, id: string): Promise<unknown>;
  reconcile(headers: Headers, id: string): Promise<unknown>;
  batch(
    headers: Headers,
    input: { ordersAfter?: string | null; inboxAfter?: string | null },
  ): Promise<unknown>;
  webhook(headers: Headers, raw: Uint8Array): Promise<unknown>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(status: number, code: string): never {
  throw new DodoHttpError(status, code);
}
function object(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail(400, "DODO_INVALID_INPUT");
  return value as Record<string, unknown>;
}
async function bytes(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "DODO_INVALID_INPUT");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) {
        await reader.cancel();
        fail(413, "DODO_REQUEST_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  return raw;
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
export function createDodoTestHttpHandler(service: DodoTestHttpService, origin: string) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url),
        prefix = "/api/dodo-test/";
      if (!url.pathname.startsWith(prefix) || request.url.length > 2048 || url.search)
        fail(400, "DODO_INVALID_INPUT");
      const path = url.pathname.slice(prefix.length);
      if (request.method === "GET" && path === "catalog") return json(service.catalog());
      const match = /^orders\/([a-f0-9-]{36})(?:\/(reconcile))?$/.exec(path);
      if (match && !uuid.test(match[1] ?? "")) fail(400, "DODO_INVALID_INPUT");
      if (request.method === "GET" && match && !match[2])
        return json(await service.read(request.headers, match[1] ?? ""));
      if (
        request.method !== "POST" ||
        !(path === "orders" || path === "webhook" || path === "admin/reconcile" || match?.[2])
      )
        fail(404, "DODO_NOT_FOUND");
      if (path !== "webhook" && request.headers.get("origin") !== origin)
        fail(403, "DODO_INVALID_ORIGIN");
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        fail(415, "DODO_CONTENT_TYPE");
      const raw = await bytes(request, path === "webhook" ? 131072 : 2048);
      if (path === "webhook") return json(await service.webhook(request.headers, raw));
      let input: unknown;
      try {
        input = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw));
      } catch {
        fail(400, "DODO_INVALID_INPUT");
      }
      if (path === "orders") {
        const value = object(input, ["requestId", "businessId"]);
        if (
          typeof value.requestId !== "string" ||
          !uuid.test(value.requestId) ||
          typeof value.businessId !== "string" ||
          !uuid.test(value.businessId)
        )
          fail(400, "DODO_INVALID_INPUT");
        return json(
          await service.create(request.headers, {
            requestId: value.requestId,
            businessId: value.businessId,
          }),
          201,
        );
      }
      if (path === "admin/reconcile") {
        const value = object(input, ["ordersAfter", "inboxAfter"]);
        const cursors: { ordersAfter?: string | null; inboxAfter?: string | null } = {};
        for (const key of ["ordersAfter", "inboxAfter"] as const) {
          if (value[key] === null) cursors[key] = null;
          else if (value[key] !== undefined) {
            if (
              typeof value[key] !== "string" ||
              !(key === "ordersAfter" ? uuid : /^[1-9][0-9]{0,18}$/).test(value[key])
            )
              fail(400, "DODO_INVALID_INPUT");
            cursors[key] = value[key];
          }
        }
        return json(await service.batch(request.headers, cursors));
      }
      object(input, []);
      return json(await service.reconcile(request.headers, match?.[1] ?? ""));
    } catch (error) {
      if (error instanceof Error) {
        const statuses: Record<string, number> = {
          DODO_WEBHOOK_SIGNATURE: 401,
          DODO_WEBHOOK_INVALID: 400,
          DODO_WEBHOOK_IDENTITY: 400,
          DODO_WEBHOOK_TOO_LARGE: 413,
        };
        const status = statuses[error.message];
        if (status) return json({ code: error.message }, status);
      }
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "code" in error &&
        typeof error.status === "number" &&
        error.status >= 400 &&
        error.status <= 599 &&
        typeof error.code === "string" &&
        /^[A-Z_]+$/.test(error.code)
      )
        return json({ code: error.code }, error.status);
      return json({ code: "DODO_TEST_UNAVAILABLE" }, 503);
    }
  };
}
