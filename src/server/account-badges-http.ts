import { type Badge, type BadgeCounts, badgesFrom } from "../lib/badges";
import { readBadgeCounts } from "./account-badges";
import {
  type OwnRequestOptions,
  openOwnRequest,
  ownFailure,
  ownReply,
} from "./account-own-request";
import { createAccountAccess } from "./auth/accounts";
import { getAuthDatabasePool, getAuthService, readAuthConfiguration } from "./auth/service";

/**
 * "Bedževi" of the signed-in account.
 *
 * GET /api/account/badges → { badges: [{ id, earned, progress?, goal? }] }
 *
 * Read only: a badge is counted from what the person has done, never set by a request.
 */
export function createAccountBadgesHandler(
  options: OwnRequestOptions & {
    counts: () => ((userId: string) => Promise<BadgeCounts | null>) | null;
  },
) {
  return async function accountBadges(request: Request): Promise<Response> {
    try {
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      if (opened.change) return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
      const read = options.counts();
      if (!read) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
      const actor = await createAccountAccess(opened.auth).session(request.headers);
      const counts = await read(actor.userId);
      const badges: Badge[] = counts ? badgesFrom(counts) : [];
      return ownReply({ badges });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleAccountBadgesRequest = createAccountBadgesHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
  counts: () => {
    const pool = getAuthDatabasePool();
    return pool ? (userId) => readBadgeCounts(pool, userId) : null;
  },
});
