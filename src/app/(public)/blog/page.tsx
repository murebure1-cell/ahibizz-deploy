import { headers } from "next/headers";
import Link from "next/link";
import { ArticleCard, FeaturedArticle } from "../../../components/content-hub/ArticleCard";
import styles from "../../../components/content-hub/content-hub.module.css";
import { Icon } from "../../../components/Icon";
import { type ArticleCategory, articleCategories, blogPath } from "../../../lib/content-hub";
import { AccountAccessError } from "../../../server/auth/accounts";
import { articleFilters, getContentHub } from "../../../server/content-hub";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "AhiBizz blog",
  description: "Vodiči, poslovni savjeti i novosti za AhiBizz zajednicu.",
};

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1>AhiBizz blog</h1>
          <p className={styles.heroLead}>
            Vodiči za lakše korištenje, savjeti za tvoj posao i novosti iz zajednice.
          </p>
          <search>
            <form action="/blog" className={styles.search}>
              <label className={styles.searchLabel} htmlFor="blog-search">
                Pretraži članke
              </label>
              <input
                id="blog-search"
                type="search"
                name="q"
                maxLength={100}
                placeholder="Npr. termin ili oglas"
                defaultValue={filters.q}
              />
              {filters.category && <input type="hidden" name="tema" value={filters.category} />}
              {filters.saved && <input type="hidden" name="sacuvano" value="1" />}
              <button type="submit">
                <Icon name="search" /> Traži
              </button>
            </form>
          </search>
        </div>
        <div aria-hidden="true" className={styles.heroImage} />
      </header>
      <nav className={styles.categories} aria-label="Teme bloga">
        <Link
          href={blogPath()}
          aria-current={!filters.category && !filters.saved && !filters.q ? "page" : undefined}
        >
          Sve teme
        </Link>
        {categories.map(([category, label]) => (
          <Link
            key={category}
            href={blogPath({ category })}
            aria-current={filters.category === category && !filters.saved ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
        <Link
          href={blogPath({ saved: true })}
          className={styles.saved}
          aria-current={filters.saved ? "page" : undefined}
        >
          <Icon name="heart" /> Sačuvani članci
        </Link>
      </nav>
      {data?.featured && <FeaturedArticle article={data.featured} />}
      {!onlyFeatured && (
        <section aria-labelledby="blog-results" className={styles.section}>
          <h2 id="blog-results">
            {filters.saved
              ? "Sačuvani članci"
              : filters.q
                ? "Rezultati pretrage"
                : filters.category
                  ? articleCategories[filters.category]
                  : "Najnoviji članci"}
          </h2>
          {signIn ? (
            <p>
              Sačuvani članci pripadaju tvom nalogu.{" "}
              <Link className={styles.inlineLink} href="/prijava?nastavi=%2Fblog%3Fsacuvano%3D1">
                Prijavi se
              </Link>
            </p>
          ) : !data ? (
            <p role="status">Članci trenutno nisu dostupni. Pokušaj ponovo kasnije.</p>
          ) : !visibleArticles.length ? (
            <p>
              {filters.saved && !filters.q
                ? "Još nema sačuvanih članaka."
                : "Nema članaka za ovaj izbor."}
            </p>
          ) : (
            <div className={styles.cards}>
              {visibleArticles.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          )}
          {data && (filters.page > 1 || data.more) && (
            <nav className={styles.pageFooter} aria-label="Stranice članaka">
              {filters.page > 1 && (
                <Link
                  className={styles.secondary}
                  href={blogPath({ ...filters, page: filters.page - 1 })}
                >
                  Prethodna
                </Link>
              )}
              <span>Stranica {filters.page}</span>
              {data.more && (
                <Link
                  className={styles.secondary}
                  href={blogPath({ ...filters, page: filters.page + 1 })}
                >
                  Sljedeća
                </Link>
              )}
            </nav>
          )}
        </section>
      )}
    </main>
  );
}
