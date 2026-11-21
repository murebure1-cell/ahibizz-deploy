import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArticleEditor } from "../../../../components/content-hub/ArticleEditor";
import styles from "../../../../components/content-hub/content-hub.module.css";
import { articleCategories, articleSlug } from "../../../../lib/content-hub";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getContentHub } from "../../../../server/content-hub";

export const dynamic = "force-dynamic";
export const metadata = { title: "Uređivanje bloga" };
const route = "/administracija/blog";

export default async function AdminBlog({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const slug = articleSlug(query.uredi) ? query.uredi : null;
  const page =
    typeof query.strana === "string" && /^[1-9]\d{0,3}$/.test(query.strana)
      ? Number(query.strana)
      : 1;
  const service = getContentHub();
  let data: Awaited<ReturnType<NonNullable<typeof service>["adminPage"]>> | undefined;
  try {
    data = await service?.adminPage(await headers(), slug, page);
  } catch (error) {
    if (error instanceof AccountAccessError) {
      if (error.status === 401) redirect("/prijava?nastavi=%2Fadministracija%2Fblog");
      if (error.status === 403) redirect("/nalog");
    }
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/administracija" className={styles.backLink}>
        Administracija
      </Link>
      <h1>Uređivanje bloga</h1>
      {query.sacuvano === "1" && data?.editing && <p role="status">Članak je sačuvan.</p>}
      {data ? (
        <div className={styles.adminGrid}>
          <div>
            <Link href={`${route}#uredi`} className={styles.secondary}>
              Novi članak
            </Link>
            {data.articles.map((article) => (
              <Link
                key={article.slug}
                className={styles.editItem}
                href={`${route}?uredi=${article.slug}&strana=${page}#uredi`}
                aria-current={slug === article.slug ? "page" : undefined}
              >
                <strong>{article.title}</strong>
                <span className={styles.caption}>
                  {articleCategories[article.category]} ·{" "}
                  {article.featured ? "Izdvojeno" : article.publishedAt ? "Objavljeno" : "Nacrt"}
                </span>
              </Link>
            ))}
            {(page > 1 || data.more) && (
              <nav className={styles.pageFooter} aria-label="Stranice članaka u administraciji">
                {page > 1 && (
                  <Link href={`${route}?strana=${page - 1}`} className={styles.secondary}>
                    Prethodna
                  </Link>
                )}
                {data.more && (
                  <Link href={`${route}?strana=${page + 1}`} className={styles.secondary}>
                    Sljedeća
                  </Link>
                )}
              </nav>
            )}
          </div>
          {slug && !data.editing ? (
            <p role="status">Odabrani članak nije pronađen.</p>
          ) : (
            <ArticleEditor
              key={data.editing ? `${data.editing.slug}-${data.editing.revision}` : "new"}
              actor={data.actor}
              article={data.editing}
            />
          )}
        </div>
      ) : (
        <p role="status">Uređivanje bloga trenutno nije dostupno.</p>
      )}
    </main>
  );
}
