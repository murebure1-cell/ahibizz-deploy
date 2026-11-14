import { healthResponse, liveHealth } from "../../../../server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return healthResponse(liveHealth());
}
