import { readAuthConfiguration } from "../../../server/auth/config";
import { getAuthDatabasePool, getAuthService } from "../../../server/auth/service";
import {
  recordTouch,
  recordView,
  type TouchKind,
  touchKinds,
  type ViewSource,
  viewSources,
  viewTarget,
} from "../../../server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * One page view: { "kind": "person" | "business", "id": "…", "source"?: "search" | … }, or a tap
 * on a business: { "kind": "touch", "id": "…", "touch": "call" | "message" | "map" }.
 * Answers 204 either way.
 */
export async function POST(request: Request) {
  const configuration = readAuthConfiguration(),
    pool = getAuthDatabasePool(),
    auth = getAuthService();
  if (!configuration || !pool) return reply(503);
  if (request.headers.get("origin") !== new URL(configuration.baseURL).origin) return reply(403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return reply(415);
  let target: ReturnType<typeof viewTarget> = null;
  let touch: TouchKind | null = null;
  let source: ViewSource = "other";
  try {
    const text = await request.text();
    if (text.length > 512) return reply(400);
    const body = JSON.parse(text) as {
      kind?: unknown;
      id?: unknown;
      touch?: unknown;
      source?: unknown;
    };
    if (body?.kind === "touch") {
      target = viewTarget("business", body.id);
      if (!touchKinds.includes(body.touch as TouchKind)) return reply(400);
      touch = body.touch as TouchKind;
    } else {
      target = viewTarget(body?.kind, body?.id);
      if (body?.source !== undefined) {
        if (!viewSources.includes(body.source as ViewSource)) return reply(400);
        source = body.source as ViewSource;
      }
    }
  } catch {
    return reply(400);
  }
  if (!target) return reply(400);
  try {
    const session = auth ? await auth.api.getSession({ headers: request.headers }) : null;
    if (touch) await recordTouch(pool, target.id, touch, session?.user?.id ?? null);
    else await recordView(pool, target, session?.user?.id ?? null, source);
  } catch {
    // A view that cannot be counted is not worth an error on the visitor's page.
  }
  return reply(204);
}
