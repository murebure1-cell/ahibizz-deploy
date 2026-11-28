import {
  type OwnRequestOptions,
  onlyKey,
  openOwnRequest,
  ownFailure,
  ownReply,
  readOwnChange,
} from "./account-own-request";
import { readMyLogins, unlinkMyGoogle } from "./auth/my-logins";
import { getAuthService, readAuthConfiguration } from "./auth/service";

/**
 * "Google nalog" as JSON, for the native app: whether the account signs in with Google and with a
 * password, and detaching Google. The web page reads and changes the same account directly.
 *
 * GET  /api/account/logins                      → { logins: { google, password } }
 * POST /api/account/logins {"google": false}    → detaches Google, { logins }
 *
 * Detaching is refused while there is no password to sign in with (409 PASSWORD_REQUIRED) and,
 * by the sign-in library's rule, more than a day after signing in (403 SIGN_IN_AGAIN). Attaching
 * is not done here: Google joins an account when the person signs in with it.
 */
export function createAccountLoginsHandler(options: OwnRequestOptions) {
  return async function accountLogins(request: Request): Promise<Response> {
    try {
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      const { auth, change } = opened;
      if (change) {
        const [key, value] = onlyKey(await readOwnChange(request)) ?? [];
        if (key !== "google" || value !== false) return ownReply({ code: "INVALID_REQUEST" }, 400);
        await unlinkMyGoogle(auth, request.headers);
      }
      return ownReply({ logins: await readMyLogins(auth, request.headers) });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleAccountLoginsRequest = createAccountLoginsHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
});
