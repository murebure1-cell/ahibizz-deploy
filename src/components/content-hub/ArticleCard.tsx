"use client";

import Link from "next/link";
import {
  type ArticleCategory,
  type ArticleSummary,
  articleCategories,
} from "../../lib/content-hub";
import { Icon, type IconName } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./blog.module.css";

/** Each topic's sign; articles carry no pictures. */
export const topicIcons: Record<ArticleCategory, IconName> = {
  vodici: "book",
  poslovanje: "chart",
  sigurnost: "shield",
  novosti: "bell",
};

/** "22. 11. 2026." on Sarajevo's clock, written by hand. */
export function articleDay(value: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB-u-nu-latn", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      timeZone: "Europe/Sarajevo",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${Number(parts.day)}. ${Number(parts.month)}. ${parts.year}.`;
}

function Meta({ article }: { article: ArticleSummary }) {
  const t = useT();
  const date = articleDay(article.publishedAt);
  return (
    <>
      {t("{count} min čitanja", { count: article.minutes })}
      {date && ` · ${date}`}
    </>
  );
}

/** An article as a row: its topic's tile, topic, title and reading time. */
export function ArticleCard({ article }: { article: ArticleSummary }) {
  const t = useT();
  return (
    <Link className={styles.row} href={`/blog/${article.slug}`}>
      <span
        className={`${styles.thumb} ${styles.tint}`}
        data-category={article.category}
        aria-hidden="true"
      >
        <Icon name={topicIcons[article.category]} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.topic}>{t(articleCategories[article.category])}</span>
        <strong dir="auto">{article.title}</strong>
        <span>
          <Meta article={article} />
        </span>
      </span>
    </Link>
  );
}

/** The featured article as the large card at the top. */
export function FeaturedArticle({ article }: { article: ArticleSummary }) {
  const t = useT();
  return (
    <Link
      className={`${styles.featured} ${styles.tint}`}
      data-category={article.category}
      href={`/blog/${article.slug}`}
    >
      <Icon name={topicIcons[article.category]} aria-hidden="true" />
      <span className={styles.label}>
        {t("Izdvojeno")} · {t(articleCategories[article.category])}
      </span>
      <span className={styles.featuredText}>
        <strong dir="auto">{article.title}</strong>
        <span>
          <Meta article={article} />
        </span>
      </span>
    </Link>
  );
}
