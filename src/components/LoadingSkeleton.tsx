import styles from "./loading-skeleton.module.css";

const rowKeys = ["first", "second", "third", "fourth", "fifth"] as const;

/** Placeholder rows shaped like the content that is loading; screen readers hear only the label. */
export function LoadingSkeleton({ label, rows = 3 }: { label: string; rows?: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      {rowKeys.slice(0, rows).map((key) => (
        <div key={key} className={styles.row} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
