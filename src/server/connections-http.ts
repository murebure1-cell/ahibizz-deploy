import {
  readConnectionItem,
  readProfileVisibility,
  readPublicPerson,
  readRelationship,
} from "../lib/connections";
import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import {
  ConnectionsAccessError,
  type ConnectionsService,
  getConnectionsService,
} from "./connections";

const noCache = { "Cache-Control": "no-store", Pragma: "no-cache" };
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noCache });
}
function invalid(): never {
  throw new ConnectionsAccessError(400, "INVALID_CONNECTION_INPUT");
}
function unsafeSearch(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (
      code < 32 ||
      code === 127 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}
function duplicateKeys(text: string) {
  const seen = new Set<string>();
  let depth = 0,
    keyExpected = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
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
    } else if (character === "{" || character === "[") {
      depth++;
      if (depth === 1) keyExpected = true;
    } else if (character === "}" || character === "]") depth--;
    else if (character === "," && depth === 1) keyExpected = true;
  }
  return false;
}
function query(url: URL, allowed: string[]) {
  const result: Record<string, string | number> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) invalid();
    if (key === "page" || key === "v") {
      if (!/^[1-9]\d{0,9}$/.test(value)) invalid();
      const number = Number(value);
      if (number > (key === "page" ? 1000 : 2147483647)) invalid();
      result[key] = number;
    } else {
      if (key === "q" && (value.trim().length > 100 || unsafeSearch(value))) invalid();
      if (key === "view" && !["incoming", "outgoing", "contacts"].includes(value)) invalid();
      result[key] = value;
    }
  }
  return result;
}
async function input(request: Request, fields: string[]) {
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new ConnectionsAccessError(413, "REQUEST_TOO_LARGE");
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
  let value: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    invalid();
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    invalid();
  if (duplicateKeys(text)) invalid();
  const body = value as Record<string, unknown>;
  if (
    typeof body.idempotencyKey !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      body.idempotencyKey,
    )
  )
    invalid();
  if (
    !Number.isInteger(body.expectedVersion) ||
    (body.expectedVersion as number) < 0 ||
    (body.expectedVersion as number) > 2147483646
  )
    invalid();
  return body;
}

export function createConnectionsHttpHandler({
  service,
  baseURL,
}: {
  service: ConnectionsService;
  baseURL: string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 8192) invalid();
      const url = new URL(request.url),
        path = url.pathname.slice("/api/connections".length);
      if (!url.pathname.startsWith("/api/connections/")) return reply({ code: "NOT_FOUND" }, 404);
      const person = /^\/people\/([A-Za-z0-9_-]{1,128})$/.exec(path);
      const media = /^\/people\/([A-Za-z0-9_-]{1,128})\/media\/(photo|cover)$/.exec(path);
      const send = /^\/people\/([A-Za-z0-9_-]{1,128})\/request$/.exec(path);
      const action =
        /^\/connections\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/(accept|decline|cancel|remove)$/i.exec(
          path,
        );
      if (request.method === "GET") {
        if (path === "/people") {
          const result = await service.searchPublic(query(url, ["q", "page"]));
          return reply({
            items: result.items.map(readPublicPerson),
            page: result.page,
            hasMore: result.hasMore,
          });
        }
        if (person) {
          query(url, []);
          const record = readPublicPerson(await service.readPublic(person[1] as string));
          const viewer = await service.readViewer(request.headers);
          const relationship =
            viewer && viewer.id !== record.id
              ? readRelationship(await service.relationship(request.headers, record.id))
              : { id: null, status: "none", direction: null, version: 0, personId: record.id };
          return reply({ person: record, viewerId: viewer?.id ?? null, relationship });
        }
        if (media) {
          const options = query(url, ["v"]);
          if (typeof options.v !== "number") invalid();
          const image = await service.readPublicMedia(
            media[1] as string,
            media[2] as "photo" | "cover",
            options.v,
          );
          if (!image) return reply({ code: "MEDIA_NOT_FOUND" }, 404);
          return new Response(new Uint8Array(image.bytes), {
            headers: {
              ...noCache,
              "Content-Type": "image/webp",
              "X-Content-Type-Options": "nosniff",
              "Cross-Origin-Resource-Policy": "same-origin",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "Content-Disposition": `inline; filename="profile-${media[2]}.webp"`,
            },
          });
        }
        if (path === "/visibility") {
          query(url, []);
          return reply({
            visibility: readProfileVisibility(await service.readVisibility(request.headers)),
          });
        }
        if (path === "/connections") {
          const options = query(url, ["view", "page"]);
          if (!options.view) invalid();
          const result = await service.list(request.headers, options);
          return reply({
            items: result.items.map(readConnectionItem),
            page: result.page,
            hasMore: result.hasMore,
          });
        }
        return reply({ code: "NOT_FOUND" }, 404);
      }
      const visibility = path === "/visibility" && request.method === "PATCH";
      if (!visibility && !(request.method === "POST" && (send || action)))
        return reply({ code: "NOT_FOUND" }, 404);
      query(url, []);
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      // Authorize before touching a stream supplied by an unauthenticated client.
      await service.readVisibility(request.headers);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const body = await input(
        request,
        visibility
          ? ["isPublic", "expectedVersion", "idempotencyKey"]
          : ["expectedVersion", "idempotencyKey"],
      );
      const key = body.idempotencyKey as string;
      if (visibility) {
        if (typeof body.isPublic !== "boolean") invalid();
        return reply({
          visibility: readProfileVisibility(
            await service.setVisibility(
              request.headers,
              { isPublic: body.isPublic, expectedVersion: body.expectedVersion },
              key,
            ),
          ),
        });
      }
      if (send)
        return reply({
          relationship: readRelationship(
            await service.request(
              request.headers,
              send[1] as string,
              { expectedVersion: body.expectedVersion },
              key,
            ),
          ),
        });
      if (action) {
        if ((body.expectedVersion as number) < 1) invalid();
        return reply({
          relationship: readRelationship(
            await service.transition(
              request.headers,
              action[1] as string,
              { action: action[2]?.toLowerCase(), expectedVersion: body.expectedVersion },
              key,
            ),
          ),
        });
      }
      return reply({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof ConnectionsAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "CONNECTIONS_UNAVAILABLE" }, 503);
    }
  };
}
export async function handleConnectionsRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getConnectionsService();
    if (!configuration || !service) return reply({ code: "CONNECTIONS_UNAVAILABLE" }, 503);
    return createConnectionsHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "CONNECTIONS_UNAVAILABLE" }, 503);
  }
}
