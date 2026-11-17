import {
  type OwnReview,
  type PublicReview,
  type ReviewCommand,
  type ReviewModerationPage,
  type ReviewPage,
  type ReviewsAdminApi,
  type ReviewsApi,
  ReviewsClientError,
} from "../../src/lib/reviews";
export const reviewFixtureBusiness = "00000000-0000-4000-8000-000000000111";
type FixtureRow = {
  review: OwnReview;
  person: string;
  name: string;
  public: boolean;
  createdAt: string;
};
/** Isolated UI-only adapter. Never fetches, connects to a database or sends messages. */
export function createBusinessReviewsMemory() {
  const rows: FixtureRow[] = [
    {
      review: {
        id: "00000000-0000-4000-8000-000000000112",
        rating: 5,
        text: "Brz dogovor i uredno završena usluga. Preporučujem.",
        version: 1,
        withdrawn: false,
        hidden: false,
      },
      person: "fixture-public-person",
      name: "Amra Hadžić",
      public: true,
      createdAt: "2026-11-16T12:00:00.000Z",
    },
    {
      review: {
        id: "00000000-0000-4000-8000-000000000113",
        rating: 4,
        text: "Ljubazni i profesionalni. Rado ću doći ponovo.",
        version: 1,
        withdrawn: false,
        hidden: false,
      },
      person: "fixture-private-person",
      name: "PRIVATNO IME",
      public: false,
      createdAt: "2026-11-15T12:00:00.000Z",
    },
  ];
  const receipts = new Map<string, { intent: string; result: ReviewCommand }>();
  function publicRow(row: FixtureRow): PublicReview {
    return {
      id: row.review.id,
      rating: row.review.rating,
      text: row.review.text,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      author: row.public
        ? { id: row.person, name: row.name, photoVersion: null }
        : { id: null, name: "Korisnik AhiBizza", photoVersion: null },
    };
  }
  function list(page = 1): ReviewPage {
    const visible = rows.filter(
      (row) => !row.review.hidden && !row.review.withdrawn && row.person !== "fixture-owner",
    );
    return {
      items: visible.slice((page - 1) * 20, page * 20).map(publicRow),
      page,
      hasMore: visible.length > page * 20,
      summary: {
        count: visible.length,
        sum: visible.reduce((sum, row) => sum + row.review.rating, 0),
      },
    };
  }
  function command(actor: string, key: string, body: unknown, write: () => ReviewCommand) {
    const full = `${actor}:${key}`,
      intent = JSON.stringify(body),
      prior = receipts.get(full);
    if (prior) {
      if (prior.intent !== intent) throw new ReviewsClientError("IDEMPOTENCY_CONFLICT", 409);
      return { ...prior.result };
    }
    const result = write();
    receipts.set(full, { intent, result });
    return { ...result };
  }
  function own(actor: string) {
    return rows.find((row) => row.person === actor);
  }
  function bound(actor: string, expected: string) {
    if (actor !== expected) throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
    if (actor === "guest") throw new ReviewsClientError("AUTHENTICATION_REQUIRED", 401);
  }
  const api = (actor = "fixture-customer"): ReviewsApi => ({
    list: async (_, page) => list(page),
    own: async () => {
      if (actor === "guest") throw new ReviewsClientError("AUTHENTICATION_REQUIRED", 401);
      return {
        accountId: actor,
        canReview: actor !== "fixture-owner",
        review: own(actor) ? ({ ...own(actor)?.review } as OwnReview) : null,
      };
    },
    save: async (_, input, expected) => {
      bound(actor, expected);
      if (actor === "fixture-owner") throw new ReviewsClientError("OWN_BUSINESS_REVIEW", 403);
      return command(actor, input.idempotencyKey, { action: "save", ...input }, () => {
        let row = own(actor);
        if ((row?.review.version ?? 0) !== input.expectedVersion)
          throw new ReviewsClientError("VERSION_CONFLICT", 409);
        if (row?.review.hidden) throw new ReviewsClientError("REVIEW_HIDDEN", 403);
        if (input.rating < 1 || input.rating > 5 || !input.text.trim() || input.text.length > 2000)
          throw new ReviewsClientError("INVALID_REVIEW_INPUT", 400);
        if (row)
          row.review = {
            ...row.review,
            rating: input.rating,
            text: input.text.trim(),
            withdrawn: false,
            version: row.review.version + 1,
          };
        else {
          row = {
            review: {
              id: crypto.randomUUID(),
              rating: input.rating,
              text: input.text.trim(),
              withdrawn: false,
              hidden: false,
              version: 1,
            },
            person: actor,
            name: "Ogledni korisnik",
            public: false,
            createdAt: new Date().toISOString(),
          };
          rows.unshift(row);
        }
        return { id: row.review.id, version: row.review.version };
      });
    },
    withdraw: async (_, input, expected) => {
      bound(actor, expected);
      return command(actor, input.idempotencyKey, { action: "withdraw", ...input }, () => {
        const row = own(actor);
        if (!row || row.review.version !== input.expectedVersion)
          throw new ReviewsClientError("VERSION_CONFLICT", 409);
        row.review = { ...row.review, withdrawn: true, version: row.review.version + 1 };
        return { id: row.review.id, version: row.review.version };
      });
    },
  });
  const admin: ReviewsAdminApi = {
    list: async (page = 1, expected) => {
      if (expected && expected !== "fixture-admin")
        throw new ReviewsClientError("ACCOUNT_IDENTITY_CHANGED", 401);
      return {
        accountId: "fixture-admin",
        page,
        hasMore: rows.length > page * 20,
        items: rows.slice((page - 1) * 20, page * 20).map((row) => ({
          ...publicRow(row),
          businessId: reviewFixtureBusiness,
          businessTitle: "Ogledna djelatnost",
          hidden: row.review.hidden,
          withdrawn: row.review.withdrawn,
          version: row.review.version,
        })),
      } satisfies ReviewModerationPage;
    },
    moderate: async (id, input, expected) => {
      bound("fixture-admin", expected);
      return command("fixture-admin", input.idempotencyKey, { id, ...input }, () => {
        const row = rows.find((row) => row.review.id === id);
        if (!row || row.review.version !== input.expectedVersion)
          throw new ReviewsClientError("VERSION_CONFLICT", 409);
        if (!input.reason.trim()) throw new ReviewsClientError("INVALID_REVIEW_INPUT", 400);
        row.review = { ...row.review, hidden: input.hidden, version: row.review.version + 1 };
        return { id, version: row.review.version };
      });
    },
  };
  return { api, admin, snapshot: () => list() };
}
