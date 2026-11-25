import {
  type BusinessMediaKind,
  readBusinessMediaManifest,
  readBusinessMediaReceipt,
  readPublicBusinessMediaManifest,
} from "../lib/business-media";
import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import {
  BusinessMediaAccessError,
  type BusinessMediaService,
  getBusinessMediaService,
} from "./business-media";

const noCache = { "Cache-Control": "no-store", Pragma: "no-cache" };
// A public image address carries its version, so the bytes behind one address never change.
// "private" keeps the copy in the visitor's own browser and out of shared caches, which limits a
// removed image to the people who had already seen it.
const publicImageCache = { "Cache-Control": "private, max-age=2592000, immutable" };
const uuidPattern = "[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const resource = new RegExp(
  `^/api/business-media/(mine|public)/(${uuidPattern})(?:/(logo|cover|gallery)/([0-8]))?$`,
  "i",
);
const uuid = new RegExp(`^${uuidPattern}$`, "i");

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noCache });
}
function invalid(): never {
  throw new BusinessMediaAccessError(400, "INVALID_BUSINESS_MEDIA_INPUT");
}
function imageVersion(url: URL, image: boolean): number | undefined {
  let version: number | undefined;
  for (const [key, value] of url.searchParams) {
    if (!image || key !== "v" || version !== undefined || !/^[1-9]\d{0,9}$/.test(value)) invalid();
    version = Number(value);
    if (version > 2147483647) invalid();
  }
  if (image && version === undefined) invalid();
  return version;
}
function writeVersion(request: Request): number {
  const match = /^"([1-9]\d{0,9})"$/.exec(request.headers.get("if-match") ?? "");
  if (!match) throw new BusinessMediaAccessError(400, "BUSINESS_VERSION_REQUIRED");
  const version = Number(match[1]);
  if (version > 2147483646) invalid();
  return version;
}
async function readImageBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new BusinessMediaAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) invalid();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createBusinessMediaHttpHandler({
  service,
  baseURL,
}: {
  service: BusinessMediaService;
  baseURL: string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 8192) invalid();
      const url = new URL(request.url),
        match = resource.exec(url.pathname);
      if (!match) return reply({ code: "NOT_FOUND" }, 404);
      if (url.hash) invalid();
      const area = match[1]?.toLowerCase(),
        id = (match[2] as string).toLowerCase(),
        kind = match[3]?.toLowerCase() as BusinessMediaKind | undefined,
        slot = kind ? Number(match[4]) : undefined;
      if (kind && (kind === "gallery" ? slot === 0 : slot !== 0)) invalid();

      if (request.method === "GET") {
        const expectedMediaVersion = imageVersion(url, Boolean(kind));
        if (!kind) {
          return area === "mine"
            ? reply({
                manifest: readBusinessMediaManifest(await service.readOwn(request.headers, id)),
              })
            : reply({ manifest: readPublicBusinessMediaManifest(await service.readPublic(id)) });
        }
        const image =
          area === "mine"
            ? await service.readOwnImage(
                request.headers,
                id,
                kind,
                slot as number,
                expectedMediaVersion as number,
              )
            : await service.readPublicImage(
                id,
                kind,
                slot as number,
                expectedMediaVersion as number,
              );
        if (!image || image.version !== expectedMediaVersion)
          return reply({ code: "MEDIA_NOT_FOUND" }, 404);
        return new Response(new Uint8Array(image.bytes), {
          headers: {
            ...(area === "public" ? publicImageCache : noCache),
            "Content-Type": "image/webp",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Disposition": `inline; filename="business-${kind}-${slot}.webp"`,
          },
        });
      }

      if (area !== "mine" || !kind || !["PUT", "DELETE"].includes(request.method))
        return reply({ code: "NOT_FOUND" }, 404);
      if (url.searchParams.size) invalid();
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      const expectedVersion = writeVersion(request),
        key = request.headers.get("idempotency-key") ?? "";
      if (!uuid.test(key)) invalid();

      // Recheck ownership/authority before touching an untrusted request stream.
      // The service repeats signed-session and version checks inside the write transaction.
      await service.readOwn(request.headers, id);
      if (request.method === "DELETE") {
        if (request.body) invalid();
        return reply({
          receipt: readBusinessMediaReceipt(
            await service.remove(
              request.headers,
              id,
              kind,
              slot as number,
              { expectedVersion },
              key.toLowerCase(),
            ),
          ),
        });
      }
      const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type))
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const bytes = await readImageBytes(request);
      return reply({
        receipt: readBusinessMediaReceipt(
          await service.save(
            request.headers,
            id,
            kind,
            slot as number,
            { expectedVersion, bytes },
            key.toLowerCase(),
          ),
        ),
      });
    } catch (error) {
      if (error instanceof BusinessMediaAccessError || error instanceof AccountAccessError)
        return reply({ code: error.code }, error.status);
      return reply({ code: "BUSINESS_MEDIA_UNAVAILABLE" }, 503);
    }
  };
}

export async function handleBusinessMediaRequest(request: Request) {
  try {
    const configuration = readAuthConfiguration(),
      service = getBusinessMediaService();
    if (!configuration || !service) return reply({ code: "BUSINESS_MEDIA_UNAVAILABLE" }, 503);
    return createBusinessMediaHttpHandler({ service, baseURL: configuration.baseURL })(request);
  } catch {
    return reply({ code: "BUSINESS_MEDIA_UNAVAILABLE" }, 503);
  }
}
