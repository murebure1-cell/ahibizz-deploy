"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import type { HomeCategory } from "../../lib/home";
import { Icon } from "../Icon";
import styles from "./home.module.css";

export function HomeCategories({
  categories,
  searchAction,
}: {
  categories: readonly HomeCategory[];
  searchAction: string;
}) {
  const navigation = useRef<HTMLElement>(null);
  const reveal = useCallback((control: HTMLElement | null) => {
    const nav = navigation.current;
    if (!nav || !control || !nav.contains(control) || nav.scrollWidth <= nav.clientWidth) return;
    const left = control.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    const right = left + control.offsetWidth;
    if (left < 3) nav.scrollLeft += left - 3;
    else if (right > nav.clientWidth - 3) nav.scrollLeft += right - nav.clientWidth + 3;
  }, []);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const observer = new ResizeObserver(() =>
      reveal(document.activeElement instanceof HTMLElement ? document.activeElement : null),
    );
    observer.observe(nav);
    return () => observer.disconnect();
  }, [reveal]);
  return (
    <nav
      ref={navigation}
      onFocusCapture={(event) => reveal(event.target)}
      className={`${styles.container} ${styles.categories}`}
      aria-label="Kategorije djelatnosti"
    >
      {categories.length ? (
        categories.map((category) => (
          <Link key={category.id} href={category.href}>
            <span className={styles.categoryIcon}>
              <Icon name={category.icon ?? "shop"} />
            </span>
            <span className={styles.categoryLabel}>{category.label}</span>
          </Link>
        ))
      ) : (
        <Link href={searchAction}>
          <span className={styles.categoryIcon}>
            <Icon name="search" />
          </span>
          <span className={styles.categoryLabel}>Sve djelatnosti</span>
        </Link>
      )}
    </nav>
  );
}
