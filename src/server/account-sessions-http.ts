import {
  type OwnRequestOptions,
  onlyKey,
  openOwnRequest,
  ownFailure,
  ownReply,
  readOwnChange,
} from "./account-own-request";
import { listMySessions, revokeMyOtherSessions, revokeMySession } from "./auth/my-logins";
import { getAuthService, readAuthConfiguration } from "./auth/service";

/** What a request asks for: one other device by its id, or every other device. Nothing else. */
function readChange(payload: unknown): { id: string } | { others: true } | null {
  const [key, value] = onlyKey(payload) ?? [];
  if (key === "id" && typeof value === "string") return { id: value };
  if (key === "others" && value === true) return { others: true };
  return null;
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
export function createAccountSessionsHandler(options: OwnRequestOptions) {
  return async function accountSessions(request: Request): Promise<Response> {
    try {
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      const { auth, change } = opened;
      if (change) {
        const wanted = readChange(await readOwnChange(request));
        if (!wanted) return ownReply({ code: "INVALID_REQUEST" }, 400);
        if ("id" in wanted) await revokeMySession(auth, request.headers, wanted.id);
        else await revokeMyOtherSessions(auth, request.headers);
      }
      return ownReply({ sessions: await listMySessions(auth, request.headers) });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleAccountSessionsRequest = createAccountSessionsHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
});
