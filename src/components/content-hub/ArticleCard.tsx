import Link from "next/link";
import { type ArticleSummary, articleCategories } from "../../lib/content-hub";
import { Icon } from "../Icon";
import styles from "./content-hub.module.css";

export function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <article className={styles.card}>
      <div className={styles.boxLabel}>{articleCategories[article.category]}</div>
      <h3>
        <Link href={`/blog/${article.slug}`}>{article.title}</Link>
      </h3>
      <p>{article.excerpt}</p>
      <footer className={styles.meta}>{article.minutes} min čitanja</footer>
    </article>
  );
}

export function FeaturedArticle({
  article,
  related,
}: {
  article: ArticleSummary;
  related: ArticleSummary[];
}) {
  return (
    <section className={styles.featured} aria-label="Izdvojeno na blogu">
      <article>
        <div className={styles.boxLabel}>Izdvojeno · {articleCategories[article.category]}</div>
        <h2>
          <Link href={`/blog/${article.slug}`}>{article.title}</Link>
        </h2>
        <p className={styles.featuredExcerpt}>{article.excerpt}</p>
        <Link className={styles.inlineLink} href={`/blog/${article.slug}`}>
          Pročitaj priču
        </Link>
      </article>
      {related.length > 0 && (
        <div className={styles.related}>
          <h3>Preporučujemo</h3>
          {related.map((item) => (
            <Link key={item.slug} href={`/blog/${item.slug}`}>
              {item.title}
              <Icon name="chevron" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
