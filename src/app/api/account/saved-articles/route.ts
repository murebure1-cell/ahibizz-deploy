import { AccountAccessError } from "../../../../server/auth/accounts";
import { articleFilters, getContentHub } from "../../../../server/content-hub";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** The first page of articles the signed-in account bookmarked, for "Sačuvano". */
export async function GET(request: Request) {
  if (new URL(request.url).search) return reply({ code: "INVALID_QUERY" }, 400);
  const hub = getContentHub();
  if (!hub) return reply({ code: "ARTICLES_UNAVAILABLE" }, 503);
  try {
    const page = await hub.publicPage(articleFilters({ sacuvano: "1" }), request.headers);
    return reply({
      articles: page.articles.map((article) => ({
        slug: article.slug,
        title: article.title,
        category: article.category,
        minutes: article.minutes,
      })),
      more: page.more,
    });
  } catch (error) {
    if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
    return reply({ code: "ARTICLES_UNAVAILABLE" }, 503);
  }
}
