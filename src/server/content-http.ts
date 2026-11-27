import { type ArticleSummary, articleCategory, articleSlug } from "../lib/content-hub";
import { AccountAccessError } from "./auth/accounts";
import { articleFilters, type createContentHub } from "./content-hub";

type ContentHub = Pick<
  ReturnType<typeof createContentHub>,
  "publicPage" | "publicArticle" | "favorites" | "setBookmark"
>;

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
const listKeys = new Set(["q", "tema", "strana", "sacuvano"]);

/** What a list shows of an article: never its body. */
function summary(article: ArticleSummary) {
  return {
    slug: article.slug,
    category: article.category,
    title: article.title,
    excerpt: article.excerpt,
    minutes: article.minutes,
    featured: article.featured,
    publishedAt: article.publishedAt ? new Date(article.publishedAt).toISOString() : null,
  };
}

function failure(error: unknown) {
  if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
  return reply({ code: "CONTENT_UNAVAILABLE" }, 503);
}

async function bodyWithin(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * The blog as JSON, for the native app: published articles, one article with its text, and the
 * signed-in person's bookmark. The web pages read the same service directly.
 */
export function createContentHttpHandler(options: {
  hub: () => ContentHub | null;
  baseURL: () => string | null;
}) {
  return {
    /** GET /api/content/articles?q=&tema=&strana=&sacuvano=1 */
    async list(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const keys = [...url.searchParams.keys()];
        const params = Object.fromEntries(url.searchParams);
        if (
          keys.some((key) => !listKeys.has(key)) ||
          new Set(keys).size !== keys.length ||
          (params.q !== undefined && params.q.length > 100) ||
          (params.tema !== undefined && !articleCategory(params.tema)) ||
          (params.strana !== undefined && !/^[1-9]\d{0,3}$/.test(params.strana)) ||
          (params.sacuvano !== undefined && params.sacuvano !== "1")
        )
          return reply({ code: "INVALID_ARTICLE_QUERY" }, 400);
        const hub = options.hub();
        if (!hub) return reply({ code: "CONTENT_UNAVAILABLE" }, 503);
        const filters = articleFilters(params);
        const page = await hub.publicPage(filters, filters.saved ? request.headers : undefined);
        return reply({
          items: page.articles.map(summary),
          featured: page.featured ? summary(page.featured) : null,
          page: filters.page,
          hasMore: page.more,
        });
      } catch (error) {
        return failure(error);
      }
    },

    /** GET /api/content/articles/:slug — with "saved" only when a signed-in person asks. */
    async article(request: Request, slug: string): Promise<Response> {
      try {
        if (!articleSlug(slug) || new URL(request.url).search)
          return reply({ code: "INVALID_ARTICLE_QUERY" }, 400);
        const hub = options.hub();
        if (!hub) return reply({ code: "CONTENT_UNAVAILABLE" }, 503);
        const article = await hub.publicArticle(slug);
        if (!article) return reply({ code: "ARTICLE_NOT_FOUND" }, 404);
        const saved = await hub
          .favorites(request.headers, slug)
          .then((value) => value.saved)
          .catch(() => null);
        return reply({ article: { ...summary(article), body: article.body }, saved });
      } catch (error) {
        return failure(error);
      }
    },

    /** PUT /api/content/articles/:slug/bookmark with {"saved": true|false}. */
    async bookmark(request: Request, slug: string): Promise<Response> {
      try {
        if (request.method !== "PUT") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
        const base = options.baseURL();
        if (!base) return reply({ code: "CONTENT_UNAVAILABLE" }, 503);
        if (request.headers.get("origin") !== new URL(base).origin)
          return reply({ code: "INVALID_ORIGIN" }, 403);
        if (!articleSlug(slug) || new URL(request.url).search)
          return reply({ code: "INVALID_ARTICLE" }, 400);
        if (
          request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
        )
          return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
        let input: unknown;
        try {
          input = JSON.parse(await bodyWithin(request, 256));
        } catch (error) {
          if (error instanceof AccountAccessError) throw error;
          return reply({ code: "INVALID_ARTICLE" }, 400);
        }
        const body = input as Record<string, unknown> | null;
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "saved") ||
          typeof body.saved !== "boolean"
        )
          return reply({ code: "INVALID_ARTICLE" }, 400);
        const hub = options.hub();
        if (!hub) return reply({ code: "CONTENT_UNAVAILABLE" }, 503);
        await hub.setBookmark(request.headers, slug, body.saved);
        return reply({ saved: body.saved });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
