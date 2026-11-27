import { readAuthConfiguration } from "../../../../server/auth/service";
import { createContentHttpHandler } from "../../../../server/content-http";
import { getContentHub } from "../../../../server/content-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const content = createContentHttpHandler({
  hub: getContentHub,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
});

/** Published blog articles as JSON, for the native app. */
export async function GET(request: Request) {
  return content.list(request);
}
