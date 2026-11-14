import { getDatabase } from "../../../../server/db";
import { healthResponse, readyHealth } from "../../../../server/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return healthResponse(await readyHealth(getDatabase()));
}
