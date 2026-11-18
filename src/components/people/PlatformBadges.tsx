import type { ProfileBadges } from "../../lib/people";
import { Icon } from "../Icon";
import styles from "./platform-badges.module.css";

export function PlatformBadges({
  platformFounder,
  platformAdministrator,
}: Pick<ProfileBadges, "platformFounder" | "platformAdministrator">) {
  if (!platformFounder && !platformAdministrator) return null;
  return (
    <ul className={styles.badges} aria-label="Uloge na AhiBizzu">
      {platformFounder && (
        <li className={styles.founder}>
          <Icon name="crown" />
          Osnivač AhiBizza
        </li>
      )}
      {platformAdministrator && (
        <li className={styles.administrator}>
          <Icon name="shield" />
          Administrator
        </li>
      )}
    </ul>
  );
}
