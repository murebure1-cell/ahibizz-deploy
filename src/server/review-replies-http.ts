import {
  type OwnRequestOptions,
  onlyKey,
  openOwnRequest,
  ownFailure,
  ownReply,
  readOwnChange,
} from "./account-own-request";
import { createAccountAccess } from "./auth/accounts";
import { getAuthDatabasePool, getAuthService, readAuthConfiguration } from "./auth/service";
import { listReviewReplies, type ReviewReply, saveReviewReply } from "./review-replies";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

type Store = {
  list(businessId: string): Promise<ReviewReply[]>;
  save(actorId: string, reviewId: string, text: string): Promise<boolean>;
};

/**
 * "Odgovor vlasnika" on a review, for the website and the native app.
 *
 * GET  /api/review-replies/businesses/<business id>          → { replies: [{reviewId,text,updatedAt}] }
 * POST /api/review-replies/reviews/<review id> {"text": "…"} → { saved: true }
 *
 * Reading is public and covers only reviews that are themselves publicly visible. Writing passes
 * the own-account guard and is allowed to the owner of the review's business; an empty text
 * removes the answer. An answer is at most 1000 characters.
 */
export function createReviewRepliesHandler(
  options: OwnRequestOptions & { store: () => Store | null },
) {
  return async function reviewReplies(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const read = /^\/api\/review-replies\/businesses\/([^/]+)$/.exec(url.pathname);
      const write = /^\/api\/review-replies\/reviews\/([^/]+)$/.exec(url.pathname);
      const store = options.store();
      if (read) {
        if (request.method !== "GET") return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
        if (url.search || !uuid.test(read[1] as string))
          return ownReply({ code: "INVALID_REQUEST" }, 400);
        if (!store) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
        return ownReply({ replies: await store.list(read[1] as string) });
      }
      if (!write) return ownReply({ code: "NOT_FOUND" }, 404);
      if (request.method !== "POST") return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      if (!store) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
      const [key, value] = onlyKey(await readOwnChange(request)) ?? [];
      const text = typeof value === "string" ? value.trim() : null;
      if (key !== "text" || text === null || text.length > 1000 || !uuid.test(write[1] as string))
        return ownReply({ code: "INVALID_REQUEST" }, 400);
      const actor = await createAccountAccess(opened.auth).session(request.headers);
      if (!(await store.save(actor.userId, write[1] as string, text)))
        return ownReply({ code: "REVIEW_NOT_FOUND" }, 404);
      return ownReply({ saved: true });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleReviewRepliesRequest = createReviewRepliesHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
  store: () => {
    const pool = getAuthDatabasePool();
    return pool
      ? {
          list: (businessId) => listReviewReplies(pool, businessId),
          save: (actorId, reviewId, text) => saveReviewReply(pool, actorId, reviewId, text),
        }
      : null;
  },
});
