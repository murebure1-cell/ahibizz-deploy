import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BookmarkForm } from "../../../../components/content-hub/BookmarkForm";
import styles from "../../../../components/content-hub/content-hub.module.css";
import { articleCategories, blogPath, formatArticleDate } from "../../../../lib/content-hub";
import { getContentHub } from "../../../../server/content-hub";

export const dynamic = "force-dynamic";
const readArticle = cache(async (slug: string) => {
  try {
    return await getContentHub()?.publicArticle(slug);
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const article = await readArticle((await params).slug);
  return article
    ? { title: article.title, description: article.excerpt }
    : { title: "AhiBizz blog" };
}

export default async function ReadArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await readArticle(slug);
  if (!article) notFound();
  const favorite = await getContentHub()
    ?.favorites(await headers(), slug)
    .catch(() => null);
  return (
    <main id="glavni-sadrzaj" className={styles.narrow}>
      <Link href="/blog" className={styles.backLink}>
        Nazad na blog
      </Link>
      <article>
        <header className={styles.articleHeader}>
          <Link href={blogPath({ category: article.category })} className={styles.inlineLink}>
            {articleCategories[article.category]}
          </Link>
          <h1>{article.title}</h1>
          <p className={styles.articleLead}>{article.excerpt}</p>
          <div className={styles.meta}>
            {article.publishedAt && (
              <time dateTime={article.publishedAt.toISOString()}>
                {formatArticleDate(article.publishedAt)}
              </time>
            )}
            <span>{article.minutes} min čitanja</span>
          </div>
        </header>
        <div className={styles.articleBody}>
          {article.body.split(/\n\s*\n/).map((paragraph, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Plain text in a server-rendered article has no mutable child state.
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <div className={styles.toolRow}>
          {favorite ? (
            <BookmarkForm
              key={favorite.actor + article.slug}
              actor={favorite.actor}
              slug={article.slug}
              initialSaved={favorite.saved}
            />
          ) : (
            <Link
              href={`/prijava?nastavi=${encodeURIComponent(`/blog/${article.slug}`)}`}
              className={styles.secondary}
            >
              Prijavi se za čuvanje članka
            </Link>
          )}
          <Link href="/blog" className={styles.inlineLink}>
            Pogledaj ostale članke
          </Link>
        </div>
      </article>
    </main>
  );
}
