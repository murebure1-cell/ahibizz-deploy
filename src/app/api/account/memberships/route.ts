import { AccountAccessError } from "../../../../server/auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";
import { createPackageSubscriptions } from "../../../../server/paypal-subscriptions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Existing paid service is visible in the Play edition without linking to external checkout. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const pool = getAuthDatabasePool();
    const auth = getAuthService();
    if (!pool || !auth) throw new Error("Account unavailable");
    const service = createPackageSubscriptions({
      environment: "live",
      pool,
      auth,
      plans: {},
      provider: null,
    });
    return Response.json(await service.list(request.headers), { headers });
  } catch (error) {
    const status = error instanceof AccountAccessError ? error.status : 503;
    return Response.json({ code: "MEMBERSHIPS_UNAVAILABLE" }, { status, headers });
  }
}
