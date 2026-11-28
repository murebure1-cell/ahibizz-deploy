import { AccountAccessError, createAccountAccess } from "./auth/accounts";
import { MyLoginsError } from "./auth/my-logins";
import type { AuthService } from "./auth/service";
import { readFlatJson } from "./flat-json";

export type OwnRequestOptions = {
  auth: () => AuthService | null;
  baseURL: () => string | null;
};

export const ownReply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

const invalid = (): never => {
  throw new AccountAccessError(400, "INVALID_REQUEST");
};
const tooLarge = (): never => {
  throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
};

/** The one small JSON value a change carries; anything else is refused as it is read. */
export const readOwnChange = (request: Request) => readFlatJson(request, invalid, tooLarge);

/** A change that asks for exactly one thing: an object with a single key. */
export function onlyKey(payload: unknown): [string, unknown] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entries = Object.entries(payload);
  const entry = entries.length === 1 ? entries[0] : undefined;
  return entry ?? null;
}

/**
 * What a request about the account's own sign-ins passes before anything is read or changed.
 *
 * - GET reads and POST changes; nothing else, and no query.
 * - A change comes from this site, as JSON.
 * - The session is read from the database, not from a cached copy.
 * - The request names the account its screen was showing, so a change never lands on an account
 *   that became the active one meanwhile.
 *
 * Answers with the sign-in service and whether this is a change, or with the refusal to send.
 */
export async function openOwnRequest(
  request: Request,
  options: OwnRequestOptions,
): Promise<{ auth: AuthService; change: boolean } | Response> {
  const auth = options.auth();
  const base = options.baseURL();
  if (!auth || !base) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  if (request.method !== "GET" && request.method !== "POST")
    return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
  if (new URL(request.url).search) return ownReply({ code: "INVALID_REQUEST" }, 400);
  const change = request.method === "POST";
  if (change) {
    if (request.headers.get("origin") !== new URL(base).origin)
      return ownReply({ code: "INVALID_ORIGIN" }, 403);
    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return ownReply({ code: "INVALID_CONTENT_TYPE" }, 415);
  }
  const current = await createAccountAccess(auth).session(request.headers);
  if (current.expectedAccountId !== current.userId)
    return ownReply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
  return { auth, change };
}

function statusOf(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : 0;
}

/** A refusal with its own code and status, or "not available" for anything unexpected. */
export function ownFailure(error: unknown): Response {
  if (error instanceof AccountAccessError || error instanceof MyLoginsError)
    return ownReply({ code: error.code }, error.status);
  // The sign-in library refusing a session that ended between two steps.
  if (statusOf(error) === 401) return ownReply({ code: "AUTHENTICATION_REQUIRED" }, 401);
  return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
}
