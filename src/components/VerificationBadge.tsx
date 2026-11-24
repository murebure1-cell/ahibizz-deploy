"use client";

import { useT } from "./i18n/LocaleProvider";
import styles from "./verification-badge.module.css";

export function VerificationBadge({ kind }: { kind: "person" | "business" }) {
  const t = useT();
  const label = kind === "person" ? t("Verifikovan lični profil") : t("Verifikovana djelatnost");
  return (
    <span className={styles.badge} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          className={styles.seal}
          d="M11 1.4q1-.9 2 0l1.8 1.6q.7.6 1.6.65l2.3.15q1.4.1 1.5 1.5l.15 2.3q.05.9.65 1.6l1.6 1.8q.9 1 0 2L21 14.8q-.6.7-.65 1.6l-.15 2.3q-.1 1.4-1.5 1.5l-2.3.15q-.9.05-1.6.65L13 22.6q-1 .9-2 0L9.2 21q-.7-.6-1.6-.65l-2.3-.15q-1.4-.1-1.5-1.5l-.15-2.3q-.05-.9-.65-1.6L1.4 13q-.9-1 0-2L3 9.2q.6-.7.65-1.6l.15-2.3q.1-1.4 1.5-1.5l2.3-.15q.9-.05 1.6-.65Z"
        />
        <path className={styles.check} d="m7.4 12 3.1 3.1 6.2-6.3" />
      </svg>
    </span>
  );
}
