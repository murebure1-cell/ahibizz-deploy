import { Icon } from "./Icon";
import styles from "./verification-badge.module.css";

export function VerificationBadge({ kind }: { kind: "person" | "business" }) {
  const label = kind === "person" ? "Verifikovan lični profil" : "Verifikovana djelatnost";
  return (
    <span className={styles.badge} role="img" aria-label={label} title={label}>
      <Icon name="check" />
    </span>
  );
}
