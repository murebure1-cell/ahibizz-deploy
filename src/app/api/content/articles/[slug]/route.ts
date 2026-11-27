import { readAuthConfiguration } from "../../../../../server/auth/service";
import { createContentHttpHandler } from "../../../../../server/content-http";
import { getContentHub } from "../../../../../server/content-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const content = createContentHttpHandler({
  hub: getContentHub,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
});

/** One published article with its text, for the native app's reader. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return content.article(request, (await context.params).slug);
}
