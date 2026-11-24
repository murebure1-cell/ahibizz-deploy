import Link from "next/link";
import type { ReactNode } from "react";
import type { HomeCategory } from "../../lib/home";
import { type Translate, translator } from "../../lib/i18n/translate";
import { Icon } from "../Icon";
import { HomeRail } from "./HomeRail";
import styles from "./home.module.css";

export function HomeCategories({
  categories,
  searchAction,
  sponsor,
  t = translator("bs"),
}: {
  t?: Translate;
  categories: readonly HomeCategory[];
  searchAction: string;
  sponsor?: ReactNode;
}) {
  return (
    <nav
      className={`${styles.container} ${styles.categoryNav}`}
      aria-label={t("Kategorije djelatnosti")}
      data-design="home-categories"
    >
      <div className={styles.browseHeading}>
        <h2>{t("Kategorije")}</h2>
        <Link href={searchAction} className={styles.subtleLink}>
          {t("Sve djelatnosti")} <Icon name="arrow" />
        </Link>
      </div>
      {categories.length > 0 && (
        <HomeRail label={t("Kategorije")} className={styles.categories}>
          {sponsor}
          {categories.map((category) => (
            <Link key={category.id} href={category.href} data-design="home-category">
              <span className={styles.categoryIcon}>
                <Icon name={category.icon ?? "shop"} />
              </span>
              <span className={styles.categoryLabel}>{t(category.label)}</span>
            </Link>
          ))}
        </HomeRail>
      )}
    </nav>
  );
}
