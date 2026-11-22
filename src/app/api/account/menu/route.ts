import {
  AccountAccessError,
  accountTransaction,
  createAccountAccess,
} from "../../../../server/auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";
export const dynamic = "force-dynamic";
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function GET(request: Request) {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  try {
    const access = createAccountAccess(auth),
      scope = await access.session(request.headers);
    const summary = await accountTransaction(pool, async (client) => {
      const user = await access.authority(client, scope, false, "read");
      const result = await client.query<{ appearance: string }>(
        "SELECT appearance FROM auth_account_preferences WHERE user_id=$1",
        [user.id],
      );
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        approval: user.approval,
        emailVerified: user.emailVerified,
        appearance: result.rows[0]?.appearance ?? "system",
      };
    });
    return reply({ account: summary });
  } catch (e) {
    return e instanceof AccountAccessError
      ? reply({ code: e.code }, e.status)
      : reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  }
}
