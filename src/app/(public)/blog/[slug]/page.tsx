import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  ArticleCard,
  articleDay,
  topicIcons,
} from "../../../../components/content-hub/ArticleCard";
import { BookmarkForm } from "../../../../components/content-hub/BookmarkForm";
import styles from "../../../../components/content-hub/blog.module.css";
import { ShareButton } from "../../../../components/directory/ShareButton";
import { Icon } from "../../../../components/Icon";
import { articleCategories, blogPath } from "../../../../lib/content-hub";
import { articleFilters, getContentHub } from "../../../../server/content-hub";
import { getTranslator } from "../../../../server/i18n";

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
    : { title: (await getTranslator())("AhiBizz blog") };
}

/** An article as drawn: a tinted band with back, save and share, then the text, then more. */
export default async function ReadArticle({ params }: { params: Promise<{ slug: string }> }) {
  const t = await getTranslator();
  const { slug } = await params;
  const article = await readArticle(slug);
  if (!article) notFound();
  const [favorite, others] = await Promise.all([
    getContentHub()
      ?.favorites(await headers(), slug)
      .catch(() => null),
    getContentHub()
      ?.publicPage(articleFilters({ tema: article.category }))
      .catch(() => null),
  ]);
  const more = (others?.articles ?? []).filter((item) => item.slug !== slug).slice(0, 3);
  const day = articleDay(article.publishedAt);
  return (
    <main id="glavni-sadrzaj" className={styles.article} data-fullscreen="true">
      <div className={`${styles.band} ${styles.tint}`} data-category={article.category}>
        <Icon name={topicIcons[article.category]} aria-hidden="true" />
        <Link
          href="/blog"
          className={`${styles.onBand} ${styles.back}`}
          aria-label={t("Nazad na blog")}
        >
          <Icon name="arrow" aria-hidden="true" />
        </Link>
        <div className={styles.bandActions}>
          <ShareButton
            title={article.title}
            path={`/blog/${article.slug}`}
            className={styles.onBand}
            statusClassName={styles.status}
          />
        </div>
      </div>
      <article className={styles.body}>
        <Link href={blogPath({ category: article.category })} className={styles.pill}>
          {t(articleCategories[article.category])}
        </Link>
        <h1 dir="auto">{article.title}</h1>
        <p className={styles.meta}>
          {day && `${day} · `}
          {t("{count} min čitanja", { count: article.minutes })}
        </p>
        <p className={styles.lead} dir="auto">
          {article.excerpt}
        </p>
        <div className={styles.text} dir="auto">
          {article.body.split(/\n\s*\n/).map((paragraph, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Plain text in a server-rendered article has no mutable child state.
            <p key={index}>{paragraph}</p>
          ))}
        </div>
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
            className={styles.inline}
          >
            {t("Prijavi se za čuvanje članka")}
          </Link>
        )}
        {more.length > 0 && (
          <section className={styles.more} aria-labelledby="article-more">
            <h2 id="article-more">{t("Pročitaj još")}</h2>
            <div className={styles.rows}>
              {more.map((item) => (
                <ArticleCard key={item.slug} article={item} />
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  );
}
