import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { getPeopleService, PeopleAccessError, type PeopleService } from "./people";

const noCache = { "Cache-Control": "no-store", Pragma: "no-cache" };
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noCache });
}
async function readBytes(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new PeopleAccessError(400, "INVALID_PROFILE_INPUT");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new PeopleAccessError(413, "REQUEST_TOO_LARGE");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export function createPeopleHttpHandler({
  service,
  baseURL,
}: {
  service: PeopleService;
  baseURL: string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 8192) return reply({ code: "INVALID_PROFILE_INPUT" }, 400);
      const url = new URL(request.url),
        me = url.pathname === "/api/people/me",
        match = /^\/api\/people\/me\/media\/(photo|cover)$/.exec(url.pathname),
        kind = match?.[1] as "photo" | "cover" | undefined;
      if (!me && !kind) return reply({ code: "NOT_FOUND" }, 404);
      const allowedQuery = request.method === "GET" && kind ? ["v", "accountId"] : [];
      const seen = new Set<string>();
      for (const [key, value] of url.searchParams) {
        if (
          !allowedQuery.includes(key) ||
          seen.has(key) ||
          !(key === "accountId" ? /^[A-Za-z0-9_-]{1,128}$/.test(value) : /^\d{1,10}$/.test(value))
        )
          return reply({ code: "INVALID_PROFILE_INPUT" }, 400);
        seen.add(key);
      }
      if (request.method === "GET") {
        if (me) return reply({ profile: await service.read(request.headers) });
        const headers = new Headers(request.headers);
        const accountId = url.searchParams.get("accountId");
        if (accountId !== null) {
          const expected = headers.get("X-AhiBizz-Account-ID");
          if (expected !== null && expected !== accountId)
            return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
          headers.set("X-AhiBizz-Account-ID", accountId);
        }
        const image = await service.readMedia(headers, kind as "photo" | "cover");
        if (!image) return reply({ code: "MEDIA_NOT_FOUND" }, 404);
        return new Response(new Uint8Array(image.bytes), {
          headers: {
            ...noCache,
            "Content-Type": image.mime,
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Disposition": `inline; filename="profile-${kind}.webp"`,
          },
        });
      }
      if (
        !(
          (me && request.method === "PATCH") ||
          (kind && ["PUT", "DELETE"].includes(request.method))
        )
      )
        return reply({ code: "NOT_FOUND" }, 404);
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      // Authentication precedes parsing or decoding any potentially expensive upload.
      await service.read(request.headers);
      const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (me) {
        if (type !== "application/json") return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
        let input: unknown;
        const bytes = await readBytes(request, 8192);
        try {
          input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch {
          return reply({ code: "INVALID_PROFILE_INPUT" }, 400);
        }
        return reply({ profile: await service.update(request.headers, input) });
      }
      const expected = /^"(\d{1,10})"$/.exec(request.headers.get("if-match") ?? "");
      if (!expected) return reply({ code: "PROFILE_VERSION_REQUIRED" }, 400);
      const expectedVersion = Number(expected[1]);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion > 2147483646)
        return reply({ code: "INVALID_PROFILE_INPUT" }, 400);
      if (request.method === "DELETE") {
        if (request.body) return reply({ code: "INVALID_PROFILE_INPUT" }, 400);
        return reply({
          profile: await service.removeMedia(request.headers, kind as "photo" | "cover", {
            expectedVersion,
          }),
        });
      }
      if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type))
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const bytes = await readBytes(request, 4 * 1024 * 1024);
      return reply({
        profile: await service.saveMedia(request.headers, kind as "photo" | "cover", {
          expectedVersion,
          bytes,
        }),
      });
    } catch (error) {
      if (error instanceof PeopleAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "PROFILE_UNAVAILABLE" }, 503);
    }
  };
}
export async function handlePeopleRequest(request: Request) {
  try {
    const config = readAuthConfiguration(),
      service = getPeopleService();
    if (!config || !service) return reply({ code: "PROFILE_UNAVAILABLE" }, 503);
    return createPeopleHttpHandler({ service, baseURL: config.baseURL })(request);
  } catch {
    return reply({ code: "PROFILE_UNAVAILABLE" }, 503);
  }
}
