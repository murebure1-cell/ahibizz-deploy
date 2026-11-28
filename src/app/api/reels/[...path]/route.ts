import { businessUuid } from "../../../../lib/business-today";
import { reelPartBytes } from "../../../../lib/reels";
import { getSearchBlockViewer } from "../../../../server/account-blocks";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { checkContribution } from "../../../../server/community-rules";
import { readFlatJson } from "../../../../server/flat-json";
import { parseReelEngagement, readReelEngagement } from "../../../../server/reels/engagement";
import { readReelRange } from "../../../../server/reels/range";
import {
  applyReelCommand,
  isModerationCommand,
  listPublicReels,
  manageReels,
  parseReelCommand,
  readReelFeed,
  reelMediaAccess,
  uploadReelPart,
} from "../../../../server/reels/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Params = { params: Promise<{ path: string[] }> };
function json(value: unknown, status = 200, cookie?: string | null) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}
const notFound = () => new AccountAccessError(404, "REEL_NOT_FOUND");
function fail(error: unknown) {
  return error instanceof AccountAccessError
    ? json({ code: error.code }, error.status)
    : json({ code: "REEL_UNAVAILABLE" }, 503);
}

function requireWrite(request: Request, type: string, identity = true) {
  const configuration = readAuthConfiguration();
  if (!configuration || request.headers.get("origin") !== new URL(configuration.baseURL).origin)
    throw new AccountAccessError(403, "INVALID_ORIGIN");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== type)
    throw new AccountAccessError(415, "REEL_INPUT");
  if (identity && !request.headers.get("X-AhiBizz-Account-ID"))
    throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
  return configuration;
}

function jsonCommand(request: Request) {
  return readFlatJson(
    request,
    () => {
      throw new AccountAccessError(400, "REEL_INPUT");
    },
    () => {
      throw new AccountAccessError(413, "REEL_INPUT");
    },
  );
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { path } = await params;
    const [area, id] = path;
    if (area === "engagement") {
      if (!businessUuid(id) || path.length !== 2 || new URL(request.url).searchParams.size)
        throw notFound();
      const config = requireWrite(request, "application/json", false);
      const input = parseReelEngagement(await jsonCommand(request));
      const result = await readReelEngagement(request.headers, id.toLowerCase(), input, config);
      return json(result.stats, 200, result.cookie);
    }
    if ((area !== "mine" && area !== "moderation") || !id || !businessUuid(id) || path.length !== 2)
      throw notFound();
    requireWrite(request, "application/json");
    const input = parseReelCommand(await jsonCommand(request));
    if (isModerationCommand(input) !== (area === "moderation")) throw notFound();
    if (input.action === "create" || input.action === "submit") {
      const denied = await checkContribution(request);
      if (denied) return denied;
    }
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
    const { path } = await params.params;
    const [area, id] = path;
    // Live public Reels, newest first, for the native app's Reels tab and story rings:
    // "?djelatnost=<id>" keeps one business, "?strana=2" goes on by 20.
    if (area === "public" && path.length === 1) {
      const query = new URL(request.url).searchParams;
      const keys = [...query.keys()];
      const scope = query.get("djelatnost");
      const page = Number(query.get("strana") ?? 1);
      if (
        keys.some((key) => key !== "djelatnost" && key !== "strana") ||
        new Set(keys).size !== keys.length ||
        (scope !== null && !businessUuid(scope)) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 50
      )
        throw new AccountAccessError(400, "REEL_INPUT");
      const viewer = await getSearchBlockViewer(request.headers);
      const items = await listPublicReels(
        scope?.toLowerCase() ?? null,
        21,
        (page - 1) * 20,
        viewer,
      );
      return json({ items: items.slice(0, 20), page, hasMore: items.length > 20 });
    }
    // The signed-in person's own Reels with their state, for the native app's "Moji reels":
    // the same list the web page renders, 30 a page.
    if (area === "mine" && path.length === 1) {
      const query = new URL(request.url).searchParams;
      const page = query.get("strana") ?? "1";
      if ([...query.keys()].some((key) => key !== "strana") || !/^[1-9]\d{0,2}$/.test(page))
        throw new AccountAccessError(400, "REEL_INPUT");
      if (!request.headers.get("X-AhiBizz-Account-ID"))
        throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
      const list = await manageReels(request.headers, false, (Number(page) - 1) * 30);
      return json({
        reels: list.reels,
        hasMore: list.hasMore,
        allowance: list.allowance,
        page: Number(page),
      });
    }
    if (area === "feed" || area === "engagement") {
      if (!businessUuid(id) || path.length !== 2) throw notFound();
      const query = new URL(request.url).searchParams;
      if (area === "engagement") {
        if (query.size || request.headers.get("sec-fetch-site") === "cross-site") throw notFound();
        const config = readAuthConfiguration();
        if (!config) throw new AccountAccessError(503, "REEL_UNAVAILABLE");
        const result = await readReelEngagement(request.headers, id.toLowerCase(), null, config);
        return json(result.stats, 200, result.cookie);
      }
      const scopes = query.getAll("djelatnost");
      const origins = query.getAll("pocetak");
      const [scope] = scopes;
      const [origin] = origins;
      if (
        query.size !== scopes.length + origins.length ||
        scopes.length > 1 ||
        origins.length > 1 ||
        (scope !== undefined && !businessUuid(scope)) ||
        (origin !== undefined && !businessUuid(origin))
      )
        throw new AccountAccessError(400, "REEL_INPUT");
      const viewer = await getSearchBlockViewer(request.headers);
      return json(
        await readReelFeed(
          id.toLowerCase(),
          scope?.toLowerCase() ?? null,
          viewer,
          origin?.toLowerCase(),
        ),
      );
    }
    return await media(request, params);
  } catch (error) {
    return fail(error);
  }
}
export async function HEAD(request: Request, params: Params) {
  try {
    return await media(request, params);
  } catch (error) {
    return fail(error);
  }
}
