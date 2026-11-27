import { activityLabel } from "../../../../lib/activity";
import { markActivityRead, readActivity } from "../../../../server/account-activity";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { readFlatJson } from "../../../../server/flat-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  return error instanceof AccountAccessError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "ACTIVITY_UNAVAILABLE" }, 503);
}

/** The signed-in account's notifications (Obavijesti), 24 a page, for the native app. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const keys = [...query.keys()];
    const page = Number(query.get("stranica") ?? 1);
    if (
      keys.some((key) => key !== "stranica") ||
      keys.length > 1 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 999
    )
      return reply({ code: "INVALID_ACTIVITY_QUERY" }, 400);
    const result = await readActivity(request.headers, page);
    return reply({
      accountId: result.accountId,
      unread: result.unread,
      hasMore: result.hasMore,
      items: result.items.map((row) => ({ ...row, label: activityLabel(row) })),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Marks one notification read ({ id, version }) or all of them ({}). */
export async function POST(request: Request) {
  try {
    const configuration = readAuthConfiguration();
    if (!configuration) return reply({ code: "ACTIVITY_UNAVAILABLE" }, 503);
    if (request.headers.get("origin") !== new URL(configuration.baseURL).origin)
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    const accountId = request.headers.get("x-ahibizz-account-id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId))
      return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
    const payload = (await readFlatJson(
      request,
      () => {
        throw new AccountAccessError(400, "INVALID_REQUEST");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    )) as Record<string, unknown> | null;
    const keys = payload && typeof payload === "object" ? Object.keys(payload) : [];
    let selection: { id: string; version: number } | undefined;
    if (keys.length) {
      if (
        keys.length !== 2 ||
        typeof payload?.id !== "string" ||
        !uuid.test(payload.id) ||
        !Number.isSafeInteger(payload.version)
      )
        return reply({ code: "INVALID_REQUEST" }, 400);
      selection = { id: payload.id, version: payload.version as number };
    }
    await markActivityRead(request.headers, accountId, selection);
    return reply({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
