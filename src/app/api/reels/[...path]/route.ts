import { businessUuid } from "../../../../lib/business-today";
import { reelPartBytes } from "../../../../lib/reels";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { readFlatJson } from "../../../../server/flat-json";
import { readReelRange } from "../../../../server/reels/range";
import {
  applyReelCommand,
  parseReelCommand,
  reelMediaAccess,
  uploadReelPart,
} from "../../../../server/reels/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Params = { params: Promise<{ path: string[] }> };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const notFound = () => new AccountAccessError(404, "REEL_NOT_FOUND");
function fail(error: unknown) {
  return error instanceof AccountAccessError
    ? json({ code: error.code }, error.status)
    : json({ code: "REEL_UNAVAILABLE" }, 503);
}

function requireWrite(request: Request, type: string) {
  const configuration = readAuthConfiguration();
  if (!configuration || request.headers.get("origin") !== new URL(configuration.baseURL).origin)
    throw new AccountAccessError(403, "INVALID_ORIGIN");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== type)
    throw new AccountAccessError(415, "REEL_INPUT");
  if (!request.headers.get("X-AhiBizz-Account-ID"))
    throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { path } = await params;
    const [area, id] = path;
    if ((area !== "mine" && area !== "moderation") || !id || !businessUuid(id) || path.length !== 2)
      throw notFound();
    requireWrite(request, "application/json");
    const input = parseReelCommand(
      await readFlatJson(
        request,
        () => {
          throw new AccountAccessError(400, "REEL_INPUT");
        },
        () => {
          throw new AccountAccessError(413, "REEL_INPUT");
        },
      ),
    );
    const review = input.action === "approve" || input.action === "reject";
    if (review !== (area === "moderation")) throw notFound();
    const status = await applyReelCommand(request.headers, id.toLowerCase(), input);
    return json({ status });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { path } = await params;
    const [area, id, action, index] = path;
    if (
      area !== "mine" ||
      !id ||
      !businessUuid(id) ||
      path.length !== 4 ||
      action !== "part" ||
      !index ||
      !/^(?:-1|0|[1-9]|[12]\d|3[01])$/.test(index)
    )
      throw notFound();
    requireWrite(request, "application/octet-stream");
    await uploadReelPart(request, id.toLowerCase(), Number(index));
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

async function media(request: Request, { params }: Params) {
  const { path } = await params;
  const [area, id, kind] = path;
  if (area !== "media" || !id || path.length !== 3 || (kind !== "poster" && kind !== "video"))
    throw notFound();
  const query = new URL(request.url).searchParams;
  const preview = query.get("pregled") === "1" && query.size === 1;
  if (!preview && query.size !== 0) throw notFound();
  const asset = await reelMediaAccess(request.headers, id.toLowerCase(), kind, preview);
  const responseHeaders = new Headers({
    "Content-Type": kind === "video" ? "video/mp4" : "image/webp",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  const requested = request.headers.get("range");
  const range = readReelRange(requested, asset.size);
  if (!range) {
    responseHeaders.set("Content-Range", `bytes */${asset.size}`);
    return new Response(null, { status: 416, headers: responseHeaders });
  }
  const { start, end } = range;
  const status = requested === null ? 200 : 206;
  responseHeaders.set("Content-Length", String(end - start + 1));
  if (status === 206) responseHeaders.set("Content-Range", `bytes ${start}-${end}/${asset.size}`);
  if (request.method === "HEAD") return new Response(null, { status, headers: responseHeaders });
  if (kind === "poster") {
    const data = await asset.slice(-1, start, end - start + 1);
    return new Response(new Blob([data]), { status, headers: responseHeaders });
  }
  let cursor = start;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const position = cursor % reelPartBytes;
      const selected = Math.floor(cursor / reelPartBytes);
      const amount = Math.min(reelPartBytes - position, end - cursor + 1);
      try {
        const bytes = await asset.slice(selected, position, amount);
        if (cancelled) return;
        controller.enqueue(bytes);
        cursor += amount;
        if (cursor > end) controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, { status, headers: responseHeaders });
}

export async function GET(request: Request, params: Params) {
  try {
    return await media(request, params);
  } catch (error) {
    return fail(error);
  }
}
export const HEAD = GET;
