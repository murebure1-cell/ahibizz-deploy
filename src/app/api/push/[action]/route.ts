import { readAccountJson } from "../../../../server/account-http";
import { AccountAccessError } from "../../../../server/auth/accounts";
import {
  getAuthDatabasePool,
  getAuthService,
  readAuthConfiguration,
} from "../../../../server/auth/service";
import { createPushService } from "../../../../server/push/service";

export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
async function handle(request: Request, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;
    if (
      new URL(request.url).search ||
      !(request.method === "GET"
        ? action === "config"
        : ["subscribe", "unsubscribe", "status", "test", "receipt"].includes(action))
    )
      return reply({ code: "NOT_FOUND" }, 404);
    const config = readAuthConfiguration(),
      auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!config || !auth || !pool) return reply({ code: "PUSH_UNAVAILABLE" }, 503);
    if (request.method === "GET")
      return reply(await createPushService(auth, pool)(request.headers, "config"));
    if (request.headers.get("origin") !== new URL(config.baseURL).origin)
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    const data = await readAccountJson(request);
    if (action === "receipt") {
      // Only the receiving worker knows this short-lived random test notification ID.
      if (
        !data ||
        typeof data !== "object" ||
        !("id" in data) ||
        typeof data.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id) ||
        !("event" in data) ||
        !["shown", "opened"].includes(String(data.event))
      )
        return reply({ code: "INVALID_REQUEST" }, 400);
      await pool.query(
        "UPDATE push_device SET test_state=$2 WHERE test_id=$1 AND test_requested_at>now()-interval '1 day' AND test_state IS DISTINCT FROM 'opened' AND test_state IS DISTINCT FROM $2",
        [data.id, data.event],
      );
      return reply({ ok: true });
    }
    return reply(await createPushService(auth, pool)(request.headers, action, data));
  } catch (error) {
    if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
    return reply({ code: "PUSH_UNAVAILABLE" }, 503);
  }
}
export const GET = handle;
export const POST = handle;
