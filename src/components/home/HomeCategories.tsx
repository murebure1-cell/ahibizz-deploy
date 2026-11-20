import Link from "next/link";
import type { HomeCategory } from "../../lib/home";
import { Icon } from "../Icon";
import { HomeRail } from "./HomeRail";
import styles from "./home.module.css";

export function HomeCategories({
  categories,
  searchAction,
}: {
  categories: readonly HomeCategory[];
  searchAction: string;
}) {
  return (
    <nav
      className={`${styles.container} ${styles.categoryNav}`}
      aria-label="Kategorije djelatnosti"
      data-design="home-categories"
    >
      <HomeRail label="Kategorije" className={styles.categories}>
        {categories.length ? (
          categories.map((category) => (
            <Link key={category.id} href={category.href} data-design="home-category">
              <span className={styles.categoryIcon}>
                <Icon name={category.icon ?? "shop"} />
              </span>
              <span className={styles.categoryLabel}>{category.label}</span>
            </Link>
          ))
        ) : (
          <Link href={searchAction}>
            <span className={styles.categoryIcon}>
              <Icon name="shop" />
            </span>
            <span className={styles.categoryLabel}>Sve djelatnosti</span>
          </Link>
        )}
      </HomeRail>
    </nav>
  );
}
