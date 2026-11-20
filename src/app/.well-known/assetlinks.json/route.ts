import { androidAssetStatements } from "../../../lib/android-association";
import { IS_PLAY_EDITION } from "../../../lib/distribution";

export const dynamic = "force-dynamic";

export function GET() {
  const statements = IS_PLAY_EDITION
    ? androidAssetStatements(process.env.AHIBIZZ_PLAY_SIGNING_SHA256)
    : [];
  return Response.json(statements, {
    status: statements.length ? 200 : 404,
    headers: { "Cache-Control": statements.length ? "public, max-age=300" : "no-store" },
  });
}
