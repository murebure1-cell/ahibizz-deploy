import { headers } from "next/headers";
import Link from "next/link";
import { ArticleCard, FeaturedArticle } from "../../../components/content-hub/ArticleCard";
import styles from "../../../components/content-hub/blog.module.css";
import { Icon } from "../../../components/Icon";
import { type ArticleCategory, articleCategories, blogPath } from "../../../lib/content-hub";
import { msg } from "../../../lib/i18n/translate";
import { AccountAccessError } from "../../../server/auth/accounts";
import { articleFilters, getContentHub } from "../../../server/content-hub";
import { getTranslator, titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("AhiBizz blog", {
  description: msg("Vodiči, poslovni savjeti i novosti za AhiBizz zajednicu."),
});

/** The blog as drawn: topics as pills, the featured article as a large card, the rest as rows. */
export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslator();
  const filters = articleFilters(await searchParams);
  const service = getContentHub();
  let data: Awaited<ReturnType<NonNullable<typeof service>["publicPage"]>> | undefined;
  let signIn = false;
  try {
    data = await service?.publicPage(filters, filters.saved ? await headers() : undefined);
  } catch (error) {
    signIn = error instanceof AccountAccessError && [401, 403].includes(error.status);
  }
  const categories = Object.entries(articleCategories) as [ArticleCategory, string][];
  const visibleArticles =
    data?.articles.filter((article) => article.slug !== data.featured?.slug) ?? [];
  const onlyFeatured = data?.featured && !visibleArticles.length && !data.more;
  const searching = Boolean(filters.q);

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.head}>
        <h1>{t("AhiBizz blog")}</h1>
        <details className={styles.searchBox} open={searching || undefined}>
          <summary className={styles.round} aria-label={t("Pretraži članke")}>
            <Icon name="search" aria-hidden="true" />
          </summary>
          <search>
            <form action="/blog" className={styles.search}>
              <input
                type="search"
                name="q"
                maxLength={100}
                aria-label={t("Pretraži članke")}
                placeholder={t("Npr. termin ili oglas")}
                defaultValue={filters.q}
              />
              {filters.category && <input type="hidden" name="tema" value={filters.category} />}
              {filters.saved && <input type="hidden" name="sacuvano" value="1" />}
              <button type="submit">{t("Traži")}</button>
            </form>
          </search>
        </details>
      </header>
      <nav className={styles.pills} aria-label={t("Teme bloga")}>
        <Link
          href={blogPath()}
          aria-current={!filters.category && !filters.saved && !filters.q ? "page" : undefined}
        >
          {t("Sve teme")}
        </Link>
        {categories.map(([category, label]) => (
          <Link
            key={category}
            href={blogPath({ category })}
            aria-current={filters.category === category && !filters.saved ? "page" : undefined}
          >
            {t(label)}
          </Link>
        ))}
        <Link href={blogPath({ saved: true })} aria-current={filters.saved ? "page" : undefined}>
          <Icon name="heart" aria-hidden="true" /> {t("Sačuvani članci")}
        </Link>
      </nav>
      {data?.featured && !searching && <FeaturedArticle article={data.featured} />}
      {!onlyFeatured && (
        <section aria-labelledby="blog-results" className={styles.section}>
          <h2 id="blog-results">
            {filters.saved
              ? t("Sačuvani članci")
              : filters.q
                ? t("Rezultati pretrage")
                : filters.category
                  ? t(articleCategories[filters.category])
                  : t("Najnoviji članci")}
          </h2>
          {signIn ? (
            <p className={styles.note}>
              {t("Sačuvani članci pripadaju tvom nalogu.")}{" "}
              <Link href="/prijava?nastavi=%2Fblog%3Fsacuvano%3D1">{t("Prijavi se")}</Link>
            </p>
          ) : !data ? (
            <p role="status" className={styles.note}>
              {t("Članci trenutno nisu dostupni. Pokušaj ponovo kasnije.")}
            </p>
          ) : !visibleArticles.length ? (
            <p className={styles.note}>
              {filters.saved && !filters.q
                ? t("Još nema sačuvanih članaka.")
                : t("Nema članaka za ovaj izbor.")}
            </p>
          ) : (
            <div className={styles.rows}>
              {visibleArticles.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          )}
          {data && (filters.page > 1 || data.more) && (
            <nav className={styles.pager} aria-label={t("Stranice članaka")}>
              {filters.page > 1 && (
                <Link href={blogPath({ ...filters, page: filters.page - 1 })}>
                  {t("Prethodna")}
                </Link>
              )}
              <span>{filters.page}</span>
              {data.more && (
                <Link href={blogPath({ ...filters, page: filters.page + 1 })}>{t("Sljedeća")}</Link>
              )}
            </nav>
          )}
        </section>
      )}
    </main>
  );
}
