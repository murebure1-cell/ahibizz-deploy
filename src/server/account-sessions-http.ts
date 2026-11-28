import { AccountAccessError, createAccountAccess } from "./auth/accounts";
import {
  listMySessions,
  MyLoginsError,
  revokeMyOtherSessions,
  revokeMySession,
} from "./auth/my-logins";
import { type AuthService, getAuthService, readAuthConfiguration } from "./auth/service";
import { readFlatJson } from "./flat-json";

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

const invalid = (): never => {
  throw new AccountAccessError(400, "INVALID_REQUEST");
};
const tooLarge = (): never => {
  throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
};

/** What a request asks for: one other device by its id, or every other device. Nothing else. */
function readChange(payload: unknown): { id: string } | { others: true } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 1) return null;
  if (keys[0] === "id" && typeof body.id === "string") return { id: body.id };
  if (keys[0] === "others" && body.others === true) return { others: true };
  return null;
}

function statusOf(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 0;
}

/**
 * "Aktivne prijave" as JSON, for the native app: the account's signed-in devices, and signing out
 * one of them or all the others. The web page reads and changes the same sessions directly.
 *
 * GET  /api/account/sessions                    → { sessions }
 * POST /api/account/sessions {"id": "…"}        → signs that other device out, { sessions }
 * POST /api/account/sessions {"others": true}   → signs every other device out, { sessions }
 *
 * A session's token never leaves the server: a device is named by its id, and the token is
 * looked up here.
 */
export function createAccountSessionsHandler(options: {
  auth: () => AuthService | null;
  baseURL: () => string | null;
}) {
  return async function accountSessions(request: Request): Promise<Response> {
    try {
      const auth = options.auth();
      const base = options.baseURL();
      if (!auth || !base) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
      if (request.method !== "GET" && request.method !== "POST")
        return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
      if (new URL(request.url).search) return reply({ code: "INVALID_REQUEST" }, 400);
      const change = request.method === "POST";
      if (change) {
        if (request.headers.get("origin") !== new URL(base).origin)
          return reply({ code: "INVALID_ORIGIN" }, 403);
        if (
          request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
        )
          return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      }
      // The session is read from the database, not from the cookie's cached copy, and the
      // request must name the account its screen was showing.
      const current = await createAccountAccess(auth).session(request.headers);
      if (current.expectedAccountId !== current.userId)
        return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
      if (change) {
        const wanted = readChange(await readFlatJson(request, invalid, tooLarge));
        if (!wanted) return reply({ code: "INVALID_REQUEST" }, 400);
        if ("id" in wanted) await revokeMySession(auth, request.headers, wanted.id);
        else await revokeMyOtherSessions(auth, request.headers);
      }
      return reply({ sessions: await listMySessions(auth, request.headers) });
    } catch (error) {
      if (error instanceof AccountAccessError || error instanceof MyLoginsError)
        return reply({ code: error.code }, error.status);
      // The sign-in library refusing a session that ended between two steps.
      if (statusOf(error) === 401) return reply({ code: "AUTHENTICATION_REQUIRED" }, 401);
      return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
    }
  };
}

export const handleAccountSessionsRequest = createAccountSessionsHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
});
