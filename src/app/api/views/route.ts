import { readAuthConfiguration } from "../../../server/auth/config";
import { getAuthDatabasePool, getAuthService } from "../../../server/auth/service";
import { recordView, viewTarget } from "../../../server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** One page view: { "kind": "person" | "business", "id": "…" }. Answers 204 either way. */
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
  try {
    const text = await request.text();
    if (text.length > 512) return reply(400);
    const body = JSON.parse(text) as { kind?: unknown; id?: unknown };
    target = viewTarget(body?.kind, body?.id);
  } catch {
    return reply(400);
  }
  if (!target) return reply(400);
  try {
    const session = auth ? await auth.api.getSession({ headers: request.headers }) : null;
    await recordView(pool, target, session?.user?.id ?? null);
  } catch {
    // A view that cannot be counted is not worth an error on the visitor's page.
  }
  return reply(204);
}
