import {
  createAccountAnalyticsService,
  readAnalyticsInput,
} from "../../../../server/account-analytics";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** The owner's own numbers for "Analitika"; "izvoz=csv" downloads them (Business). */
export async function GET(request: Request) {
  try {
    const auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    const input = readAnalyticsInput(new URL(request.url).searchParams);
    const result = await createAccountAnalyticsService(auth, pool).read(request.headers, input);
    if (typeof result === "string")
      return new Response(result, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ahibizz-analitika-${input.days}-dana.csv"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    return reply(result);
  } catch (error) {
    if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
    return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  }
}
