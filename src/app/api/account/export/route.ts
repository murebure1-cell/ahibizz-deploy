import { createAccountExportService, readExportParts } from "../../../../server/account-export";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** The signed-in account's own data as one JSON file, downloaded at once. */
export async function GET(request: Request) {
  try {
    const auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "dijelovi"))
      return reply({ code: "INVALID_ACCOUNT_QUERY" }, 400);
    const parts = readExportParts(url.searchParams.get("dijelovi"));
    const data = await createAccountExportService(auth, pool).export(request.headers, parts);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ahibizz-podaci-${day}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
    return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  }
}
