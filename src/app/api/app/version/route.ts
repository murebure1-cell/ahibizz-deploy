import { minimumAppVersion } from "../../../../lib/app-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/app/version → { minimum }: the oldest native app version this server still serves. */
export function GET() {
  return Response.json(
    { minimum: minimumAppVersion },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
