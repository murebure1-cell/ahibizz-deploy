"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import type { HomeCategory } from "../../lib/home";
import { Icon } from "../Icon";
import styles from "./home.module.css";

/** How many tiles the closed grid shows before the one that opens the rest. */
const closedTiles = 5;

/**
 * Category tiles under the search field. Five fit beside the tile that opens the rest; names
 * of up to ten letters sit three in a row, longer ones two in a row so they stay readable.
 */
export function HomeCategoryGrid({
  categories,
  sponsor,
  allLabel,
  fewerLabel,
}: {
  categories: readonly (Omit<HomeCategory, "icon"> & { icon: NonNullable<HomeCategory["icon"]> })[];
  sponsor?: ReactNode;
  allLabel: string;
  fewerLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const foldable = categories.length > closedTiles + 1;
  const shown = foldable && !expanded ? categories.slice(0, closedTiles) : categories;
  return (
    <div
      className={styles.categories}
      data-columns={shown.every((category) => category.label.length <= 10) ? 3 : 2}
    >
      {sponsor}
      {shown.map((category) => (
        <Link key={category.id} href={category.href} data-design="home-category">
          <Icon name={category.icon} />
          <span className={styles.categoryLabel}>{category.label}</span>
        </Link>
      ))}
      {foldable && (
        <button
          type="button"
          className={styles.categoryAll}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? fewerLabel : allLabel}
        </button>
      )}
    </div>
  );
}
