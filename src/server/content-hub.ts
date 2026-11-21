import type { Pool } from "pg";
import {
  type ArticleCategory,
  type ArticleSummary,
  articleCategory,
  articleSlug,
  type BlogArticle,
  contentSearchKey,
  readMinutes,
  searchInput,
} from "../lib/content-hub";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

const columnList =
  'a.slug,a.category,a.title,a.excerpt,a.featured,a.published_at AS "publishedAt",a.body,a.revision';
const matchesSearch =
  "position($2 in translate(lower(normalize(a.title || ' ' || a.excerpt || ' ' || a.body,NFC)),'čćžšđ','cczsd'))>0";
export const articlePageSize = 12;

type Filters = { category: ArticleCategory | null; q: string; page: number; saved: boolean };
const filterValues = (filters: Filters): [ArticleCategory | null, string] => [
  filters.category,
  contentSearchKey(searchInput(filters.q)),
];
function summary({
  body,
  revision: _revision,
  ...article
}: Omit<BlogArticle, "minutes">): ArticleSummary {
  return { ...article, minutes: readMinutes(body) };
}

export function articleFilters(params: Record<string, string | string[] | undefined>): Filters {
  const page =
    typeof params.strana === "string" && /^[1-9]\d{0,3}$/.test(params.strana)
      ? Number(params.strana)
      : 1;
  return {
    category: articleCategory(params.tema),
    q: searchInput(params.q),
    page,
    saved: params.sacuvano === "1",
  };
}

function readEditorInput(input: Record<string, unknown>) {
  const trim = (item: unknown) => (typeof item === "string" ? item.normalize("NFC").trim() : "");
  const slug = trim(input.slug);
  const title = trim(input.title);
  const excerpt = trim(input.excerpt);
  const body = trim(input.body).replace(/\r\n?/g, "\n");
  const category = articleCategory(input.category);
  const revision = typeof input.revision === "number" ? input.revision : Number(input.revision);
  const published = input.published === "yes",
    featured = input.featured === "yes";
  if (
    !articleSlug(slug) ||
    !category ||
    title.length < 3 ||
    title.length > 125 ||
    /\p{Cc}/u.test(title) ||
    excerpt.length < 10 ||
    excerpt.length > 300 ||
    /\p{Cc}/u.test(excerpt) ||
    body.length < 30 ||
    body.length > 20000 ||
    /\p{Cc}/u.test(body.replace(/[\n\t]/g, "")) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    (featured && !published)
  )
    throw new AccountAccessError(400, "INVALID_ARTICLE");
  return { slug, title, excerpt, body, category, revision, published, featured };
}

export function createContentHub(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  async function favorites(headers: Headers, slug: string) {
    const current = await access.session(headers);
    return accountTransaction(pool, async (client) => {
      const user = await access.authority(client, current, false, "read");
      const saved = await client.query(
        "SELECT 1 FROM blog_bookmark WHERE account_id = $1 AND article_slug = $2",
        [user.id, slug],
      );
      return { actor: user.id, saved: Boolean(saved.rowCount) };
    });
  }
  return {
    async publicPage(filters: Filters, requestHeaders?: Headers) {
      const parameters = [...filterValues(filters), (filters.page - 1) * articlePageSize];
      const remaining = `WHERE a.published_at IS NOT NULL AND ($1::text IS NULL OR a.category=$1) AND ($2='' OR ${matchesSearch})
        ORDER BY a.published_at DESC,a.slug OFFSET $3 LIMIT ${articlePageSize + 1}`;
      if (filters.saved) {
        if (!requestHeaders) throw new AccountAccessError(401, "AUTHENTICATION_REQUIRED");
        const current = await access.session(requestHeaders);
        return accountTransaction(pool, async (client) => {
          const user = await access.authority(client, current, false, "read");
          const result = await client.query<Omit<BlogArticle, "minutes">>(
            `SELECT ${columnList} FROM blog_article a JOIN blog_bookmark b ON b.article_slug=a.slug AND b.account_id=$4 ${remaining}`,
            [...parameters, user.id],
          );
          return {
            articles: result.rows.slice(0, articlePageSize).map(summary),
            more: result.rows.length > articlePageSize,
            featured: null,
          };
        });
      }
      const showFeatured = filters.page === 1 && !filters.q && !filters.category;
      const [result, highlight] = await Promise.all([
        pool.query<Omit<BlogArticle, "minutes">>(
          `SELECT ${columnList} FROM blog_article a ${remaining}`,
          parameters,
        ),
        showFeatured
          ? pool.query<Omit<BlogArticle, "minutes">>(
              `SELECT ${columnList} FROM blog_article a WHERE a.featured AND a.published_at IS NOT NULL LIMIT 1`,
            )
          : null,
      ]);
      return {
        articles: result.rows.slice(0, articlePageSize).map(summary),
        more: result.rows.length > articlePageSize,
        featured: highlight?.rows[0] ? summary(highlight.rows[0]) : null,
      };
    },
    async publicArticle(slug: unknown) {
      if (!articleSlug(slug)) return null;
      const result = await pool.query<Omit<BlogArticle, "minutes">>(
        `SELECT ${columnList} FROM blog_article a WHERE a.slug=$1 AND a.published_at IS NOT NULL`,
        [slug],
      );
      const article = result.rows[0];
      return article ? { ...article, minutes: readMinutes(article.body) } : null;
    },
    favorites,
    async setBookmark(headers: Headers, slug: unknown, save: unknown) {
      if (!articleSlug(slug) || typeof save !== "boolean")
        throw new AccountAccessError(400, "INVALID_ARTICLE");
      const current = await access.session(headers);
      if (!current.expectedAccountId) throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
      return accountTransaction(pool, async (client) => {
        const user = await access.authority(client, current);
        if (!save) {
          await client.query("DELETE FROM blog_bookmark WHERE account_id=$1 AND article_slug=$2", [
            user.id,
            slug,
          ]);
          return;
        }
        const article = await client.query(
          "SELECT 1 FROM blog_article WHERE slug=$1 AND published_at IS NOT NULL FOR SHARE",
          [slug],
        );
        if (!article.rowCount) throw new AccountAccessError(404, "ARTICLE_MISSING");
        await client.query(
          "INSERT INTO blog_bookmark(account_id,article_slug) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [user.id, slug],
        );
      });
    },
    async adminPage(headers: Headers, slug: string | null, page: number) {
      const current = await access.session(headers);
      return accountTransaction(pool, async (client) => {
        const user = await access.authority(client, current, true, "read");
        const result = await client.query<Omit<BlogArticle, "minutes">>(
          `SELECT ${columnList} FROM blog_article a ORDER BY updated_at DESC,slug OFFSET $1 LIMIT ${articlePageSize + 1}`,
          [(page - 1) * articlePageSize],
        );
        const editing = slug
          ? (
              await client.query<Omit<BlogArticle, "minutes">>(
                `SELECT ${columnList} FROM blog_article a WHERE slug=$1`,
                [slug],
              )
            ).rows[0]
          : undefined;
        return {
          actor: user.id,
          articles: result.rows.slice(0, articlePageSize).map(summary),
          more: result.rows.length > articlePageSize,
          editing,
        };
      });
    },
    async saveArticle(headers: Headers, input: Record<string, unknown>) {
      const article = readEditorInput(input);
      const current = await access.session(headers);
      if (!current.expectedAccountId) throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
      return accountTransaction(pool, async (client) => {
        await access.authority(client, current, true);
        // Publishing and changing the featured slot are one transaction, including when two editors work at once.
        await client.query("SELECT pg_advisory_xact_lock(563571448,45)");
        const existing = await client.query<{ revision: number }>(
          "SELECT revision FROM blog_article WHERE slug=$1 FOR UPDATE",
          [article.slug],
        );
        if ((existing.rows[0]?.revision ?? 0) !== article.revision)
          throw new AccountAccessError(409, "ARTICLE_CHANGED");
        if (article.featured) {
          await client.query(
            "UPDATE blog_article SET featured=false,revision=revision+1,updated_at=now() WHERE featured AND slug<>$1",
            [article.slug],
          );
        }
        const values = [
          article.slug,
          article.category,
          article.title,
          article.excerpt,
          article.body,
          article.featured,
          article.published,
        ];
        await client.query(
          `INSERT INTO blog_article(slug,category,title,excerpt,body,featured,published_at)
          VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() END)
          ON CONFLICT(slug) DO UPDATE SET category=excluded.category,title=excluded.title,excerpt=excluded.excerpt,body=excluded.body,
          featured=excluded.featured,published_at=CASE WHEN $7 THEN COALESCE(blog_article.published_at,now()) END,
          revision=blog_article.revision+1,updated_at=now()`,
          values,
        );
        return article.slug;
      });
    },
  };
}

export function getContentHub() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  return auth && pool ? createContentHub(auth, pool) : null;
}
