import { createAppSignInHandler } from "../../../../server/app-sign-in-http";
import { getAuthService, readAuthConfiguration } from "../../../../server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The confirmation form of /nalog/aplikacija: mints the app's one-time code and opens the app. */
export async function POST(request: Request) {
  try {
    const configuration = readAuthConfiguration();
    const auth = getAuthService();
    if (!configuration || !auth)
      return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
    return await createAppSignInHandler({
      baseURL: configuration.baseURL,
      start: (input) => auth.api.startAppHandoff(input),
    })(request);
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
