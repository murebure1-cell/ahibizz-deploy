import { readAuthConfiguration } from "../../../../../../server/auth/service";
import { createContentHttpHandler } from "../../../../../../server/content-http";
import { getContentHub } from "../../../../../../server/content-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const content = createContentHttpHandler({
  hub: getContentHub,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
});

/** Saves or forgets an article for the signed-in person (Sačuvano). */
export async function PUT(request: Request, context: { params: Promise<{ slug: string }> }) {
  return content.bookmark(request, (await context.params).slug);
}
