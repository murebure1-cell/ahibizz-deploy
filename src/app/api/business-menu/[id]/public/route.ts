import { getAuthDatabasePool } from "../../../../../server/auth/service";
import { readPublicMenu } from "../../../../../server/business-menu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The menu of a published business as its public page shows it, for the native app. An unknown,
 * unpublished or menu-less business answers an empty menu, never who owns it or its version.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (new URL(request.url).search) return reply({ code: "INVALID_MENU" }, 400);
  const pool = getAuthDatabasePool();
  if (!pool) return reply({ code: "MENU_UNAVAILABLE" }, 503);
  try {
    const menu = await readPublicMenu(pool, (await params).id);
    return reply({ menu: { items: menu.items, meat: menu.meat } });
  } catch {
    return reply({ code: "MENU_UNAVAILABLE" }, 503);
  }
}
