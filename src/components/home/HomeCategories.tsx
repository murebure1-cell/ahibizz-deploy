import type { ReactNode } from "react";
import type { HomeCategory } from "../../lib/home";
import { type Translate, translator } from "../../lib/i18n/translate";
import { HomeCategoryGrid } from "./HomeCategoryGrid";
import styles from "./home.module.css";

export function HomeCategories({
  categories,
  sponsor,
  t = translator("bs"),
}: {
  t?: Translate;
  categories: readonly HomeCategory[];
  sponsor?: ReactNode;
}) {
  return (
    <nav
      className={`${styles.container} ${styles.categoryNav}`}
      aria-label={t("Kategorije djelatnosti")}
      data-design="home-categories"
    >
      <h2 className={styles.srOnly}>{t("Kategorije")}</h2>
      {(categories.length > 0 || Boolean(sponsor)) && (
        <HomeCategoryGrid
          sponsor={sponsor}
          allLabel={t("Sve kategorije")}
          fewerLabel={t("Manje kategorija")}
          categories={categories.map((category) => ({
            id: category.id,
            href: category.href,
            icon: category.icon ?? "shop",
            label: t(category.label),
          }))}
        />
      )}
    </nav>
  );
}
