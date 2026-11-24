"use client";

import type { ProfileBadges } from "../../lib/people";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./platform-badges.module.css";

export function PlatformBadges({
  platformFounder,
  platformAdministrator,
}: Pick<ProfileBadges, "platformFounder" | "platformAdministrator">) {
  const t = useT();
  if (!platformFounder && !platformAdministrator) return null;
  return (
    <ul className={styles.badges} aria-label={t("Uloge na AhiBizzu")}>
      {platformFounder && (
        <li className={styles.founder}>
          <Icon name="crown" />
          {t("Osnivač AhiBizza")}
        </li>
      )}
      {platformAdministrator && (
        <li className={styles.administrator}>
          <Icon name="shield" />
          {t("Administrator")}
        </li>
      )}
    </ul>
  );
}
