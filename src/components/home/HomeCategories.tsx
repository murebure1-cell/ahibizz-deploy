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
      <div className={styles.browseHeading}>
        <h2>Kategorije</h2>
        <Link href={searchAction} className={styles.subtleLink}>
          Sve djelatnosti <Icon name="arrow" />
        </Link>
      </div>
      {categories.length > 0 && (
        <HomeRail label="Kategorije" className={styles.categories}>
          {categories.map((category) => (
            <Link key={category.id} href={category.href} data-design="home-category">
              <span className={styles.categoryIcon}>
                <Icon name={category.icon ?? "shop"} />
              </span>
              <span className={styles.categoryLabel}>{category.label}</span>
            </Link>
          ))}
        </HomeRail>
      )}
    </nav>
  );
}
