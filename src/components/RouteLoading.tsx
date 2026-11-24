import styles from "./loading-skeleton.module.css";

const rowKeys = ["first", "second", "third"] as const;

/**
 * Shown the moment a link is tapped, while the server prepares the next page, so a tap always
 * answers at once. Shaped like a page: a heading and a few content blocks.
 */
export function RouteLoading({ label }: { label: string }) {
  return (
    <main id="glavni-sadrzaj" className={styles.route} aria-busy="true">
      <div className={styles.skeleton} role="status" aria-label={label}>
        <span className={styles.title} aria-hidden="true" />
        {rowKeys.map((key) => (
          <div key={key} className={styles.row} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </main>
  );
}
