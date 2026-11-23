export type ReviewSummary = { count: number; sum: number };
export type ReviewAuthor = { id: string | null; name: string; photoVersion: number | null };
export type PublicReview = {
  id: string;
  rating: number;
  text: string;
  createdAt: string;
  updatedAt: string;
  author: ReviewAuthor;
};
export type ReviewPage = {
  items: PublicReview[];
  page: number;
  hasMore: boolean;
  summary: ReviewSummary;
};
export type OwnReview = {
  id: string;
  rating: number;
  text: string;
  withdrawn: boolean;
  hidden: boolean;
  version: number;
};
export type OwnReviewState = { accountId: string; canReview: boolean; review: OwnReview | null };
export type ReviewCommand = { id: string; version: number };
export type ReviewSaveInput = {
  rating: number;
  text: string;
  expectedVersion: number;
  idempotencyKey: string;
};
export type ReviewVersionInput = { expectedVersion: number; idempotencyKey: string };
export type ReviewModerationItem = PublicReview & {
  businessId: string;
  businessTitle: string;
  version: number;
  hidden: boolean;
  withdrawn: boolean;
};
export type ReviewModerationPage = {
  items: ReviewModerationItem[];
  page: number;
  hasMore: boolean;
  accountId: string;
};
export type ReviewsAdminApi = {
  list(page?: number, accountId?: string, signal?: AbortSignal): Promise<ReviewModerationPage>;
  moderate(
    id: string,
    input: ReviewVersionInput & { hidden: boolean; reason: string },
    accountId: string,
  ): Promise<ReviewCommand>;
};
export type ReviewsApi = {
  list(businessId: string, page?: number): Promise<ReviewPage>;
  own(businessId: string): Promise<OwnReviewState>;
  save(businessId: string, input: ReviewSaveInput, accountId: string): Promise<ReviewCommand>;
  withdraw(
    businessId: string,
    input: ReviewVersionInput,
    accountId: string,
  ): Promise<ReviewCommand>;
};
export class ReviewsClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_reviews_response");
  return value as Record<string, unknown>;
}
function integer(v: unknown, min: number, max = 2147483647): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}
function id(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
}
export function readReviewSummary(value: unknown): ReviewSummary {
  const v = record(value);
  if (
    !integer(v.count, 0) ||
    !integer(v.sum, 0, Number.MAX_SAFE_INTEGER) ||
    v.sum < v.count ||
    v.sum > 5 * v.count
  )
    throw new Error("invalid_reviews_response");
  return { count: v.count, sum: v.sum };
}
export function readPublicReview(value: unknown): PublicReview {
  const v = record(value),
    author = record(v.author);
  if (
    !id(v.id) ||
    !integer(v.rating, 1, 5) ||
    typeof v.text !== "string" ||
    !v.text.trim() ||
    v.text.length > 2000 ||
    typeof v.createdAt !== "string" ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    typeof v.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(v.updatedAt)) ||
    !(author.id === null || id(author.id)) ||
    typeof author.name !== "string" ||
    !author.name.trim() ||
    author.name.length > 100 ||
    !(author.photoVersion === null || integer(author.photoVersion, 1))
  )
    throw new Error("invalid_reviews_response");
  return {
    id: v.id,
    rating: v.rating,
    text: v.text,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    author:
      author.id === null
        ? { id: null, name: "Korisnik AhiBizza", photoVersion: null }
        : {
            id: author.id as string,
            name: author.name,
            photoVersion: author.photoVersion as number | null,
          },
  };
}
export function readReviewPage(value: unknown): ReviewPage {
  const v = record(value);
  if (
    !Array.isArray(v.items) ||
    v.items.length > 20 ||
    !integer(v.page, 1, 1000) ||
    typeof v.hasMore !== "boolean"
  )
    throw new Error("invalid_reviews_response");
  return {
    items: v.items.map(readPublicReview),
    page: v.page,
    hasMore: v.hasMore,
    summary: readReviewSummary(v.summary),
  };
}
export function readOwnReviewState(value: unknown): OwnReviewState {
  const v = record(value);
  if (!id(v.accountId) || typeof v.canReview !== "boolean")
    throw new Error("invalid_reviews_response");
  if (v.review === null) return { accountId: v.accountId, canReview: v.canReview, review: null };
  const r = record(v.review);
  if (
    !id(r.id) ||
    !integer(r.rating, 1, 5) ||
    typeof r.text !== "string" ||
    !r.text.trim() ||
    r.text.length > 2000 ||
    typeof r.withdrawn !== "boolean" ||
    typeof r.hidden !== "boolean" ||
    !integer(r.version, 1)
  )
    throw new Error("invalid_reviews_response");
  return {
    accountId: v.accountId,
    canReview: v.canReview,
    review: {
      id: r.id,
      rating: r.rating,
      text: r.text,
      withdrawn: r.withdrawn,
      hidden: r.hidden,
      version: r.version,
    },
  };
}
export function readReviewCommand(value: unknown): ReviewCommand {
  const v = record(value);
  if (!id(v.id) || !integer(v.version, 1)) throw new Error("invalid_reviews_response");
  return { id: v.id, version: v.version };
}
export function readReviewModerationPage(value: unknown): ReviewModerationPage {
  const v = record(value);
  if (
    !Array.isArray(v.items) ||
    v.items.length > 20 ||
    !integer(v.page, 1, 1000) ||
    typeof v.hasMore !== "boolean" ||
    !id(v.accountId)
  )
    throw new Error("invalid_reviews_response");
  return {
    accountId: v.accountId,
    page: v.page,
    hasMore: v.hasMore,
    items: v.items.map((item) => {
      const r = record(item);
      if (
        !id(r.businessId) ||
        typeof r.businessTitle !== "string" ||
        !r.businessTitle.trim() ||
        r.businessTitle.length > 120 ||
        !integer(r.version, 1) ||
        typeof r.hidden !== "boolean" ||
        typeof r.withdrawn !== "boolean"
      )
        throw new Error("invalid_reviews_response");
      return {
        ...readPublicReview(r),
        businessId: r.businessId,
        businessTitle: r.businessTitle,
        version: r.version,
        hidden: r.hidden,
        withdrawn: r.withdrawn,
      };
    }),
  };
}
export function createReviewsAdminApi(fetcher: typeof fetch = fetch): ReviewsAdminApi {
  async function request(path: string, body?: unknown, accountId?: string, signal?: AbortSignal) {
    const response = await fetcher(`/api/reviews/admin${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(accountId ? { "X-AhiBizz-Account-ID": accountId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok)
      throw new ReviewsClientError(
        typeof value?.code === "string" ? value.code : "REVIEWS_UNAVAILABLE",
        response.status,
      );
    return value;
  }
  return {
    list: async (page = 1, actor, signal) =>
      readReviewModerationPage(await request(`?page=${page}`, undefined, actor, signal)),
    moderate: async (id, body, actor) => {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("invalid_review_id");
      return readReviewCommand(await request(`/${id}/moderate`, body, actor));
    },
  };
}
export function createReviewsApi(fetcher: typeof fetch = fetch): ReviewsApi {
  async function request(path: string, method = "GET", body?: unknown, accountId?: string) {
    const response = await fetcher(`/api/reviews${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(accountId ? { "X-AhiBizz-Account-ID": accountId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok)
      throw new ReviewsClientError(
        typeof value?.code === "string" ? value.code : "REVIEWS_UNAVAILABLE",
        response.status,
      );
    return value;
  }
  const business = (value: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error("invalid_business_id");
    return `/businesses/${encodeURIComponent(value)}`;
  };
  return {
    list: async (id, page = 1) => readReviewPage(await request(`${business(id)}?page=${page}`)),
    own: async (id) => {
      const value = await request(`${business(id)}/own`);
      if ((value as { anonymous?: unknown })?.anonymous === true)
        throw new ReviewsClientError("AUTHENTICATION_REQUIRED", 401);
      return readOwnReviewState(value);
    },
    save: async (id, body, actor) =>
      readReviewCommand(await request(`${business(id)}/own`, "PUT", body, actor)),
    withdraw: async (id, body, actor) =>
      readReviewCommand(await request(`${business(id)}/withdraw`, "POST", body, actor)),
  };
}
