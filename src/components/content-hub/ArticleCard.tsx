"use client";

import Link from "next/link";
import { type ArticleSummary, articleCategories } from "../../lib/content-hub";
import { useT } from "../i18n/LocaleProvider";
import styles from "./content-hub.module.css";

export function ArticleCard({ article }: { article: ArticleSummary }) {
  const t = useT();
  return (
    <article className={styles.card}>
      <div className={styles.boxLabel}>{t(articleCategories[article.category])}</div>
      <h3>
        <Link href={`/blog/${article.slug}`} dir="auto">
          {article.title}
        </Link>
      </h3>
      <p dir="auto">{article.excerpt}</p>
      <footer className={styles.meta}>
        {t("{count} min čitanja", { count: article.minutes })}
      </footer>
    </article>
  );
}

export function FeaturedArticle({ article }: { article: ArticleSummary }) {
  const t = useT();
  return (
    <article className={styles.featured} aria-label={t("Izdvojeno na blogu")}>
      <div className={styles.boxLabel}>
        {t("Izdvojeno")} · {t(articleCategories[article.category])}
      </div>
      <h2>
        <Link href={`/blog/${article.slug}`} dir="auto">
          {article.title}
        </Link>
      </h2>
      <p className={styles.featuredExcerpt} dir="auto">
        {article.excerpt}
      </p>
    </article>
  );
}
