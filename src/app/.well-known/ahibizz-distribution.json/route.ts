import { IS_PLAY_EDITION } from "../../../lib/distribution";

export function GET() {
  return Response.json(
    { application: "AhiBizz", distribution: IS_PLAY_EDITION ? "google-play" : "web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
