"use client";

import Link from "next/link";
import { useState } from "react";
import { type AppMenuAccess, appMenuGroups } from "../../lib/app-menu";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { localeNames } from "../../lib/i18n/locales";
import { forgetRememberedArea } from "../../lib/location-area-storage";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { type PackageId, packageName } from "../../lib/packages";
import { AccountSwitch } from "../account/AccountSwitch";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { profileInitials } from "../people/PersonalProfileCard";
import { useOptionalAppPwa } from "../pwa/AppPwa";
import { Row, RowGroup, RowPill, rowStyles, ScreenBar } from "../ui/Rows";
import styles from "./app-menu.module.css";

export type MenuAccount = { id: string; name: string; owner: boolean; founder?: boolean };

/**
 * The menu screen: who is signed in, then every place that is not in the dock, in groups. A
 * function that is announced but not built shows "Uskoro" and leads nowhere.
 */
export function AppMenu({
  account,
  packageId,
  supportAvailable,
}: {
  account: MenuAccount | null;
  packageId: PackageId | null;
  supportAvailable: boolean;
}) {
  const { t, locale } = useI18n();
  const { resetAppearance } = useAppAppearance();
  const installed = useOptionalAppPwa()?.installed ?? true;
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const access: AppMenuAccess = account ? (account.owner ? "owner" : "member") : "guest";
  const groups = appMenuGroups(access, {
    installed,
    playEdition: IS_PLAY_EDITION,
    supportAvailable,
  });
  async function signOut() {
    if (leaving || !account) return;
    setLeaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok || (await response.json()).ok !== true) throw new Error("sign-out");
      clearBrowserMessagingRecovery(account.id);
      forgetRememberedArea();
      resetAppearance();
      window.location.assign("/prijava");
    } catch {
      setError(t("Odjava nije uspjela. Pokušaj ponovo."));
      setLeaving(false);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen} data-design="app-menu-screen">
      <ScreenBar title={t("Meni")} backHref={account ? "/nalog" : "/"} backLabel={t("Nazad")} />
      {account ? (
        <Link href="/nalog" className={styles.who} prefetch={false}>
          <span
            className={styles.avatar}
            data-founder={account.founder ? "" : undefined}
            aria-hidden="true"
          >
            {profileInitials(account.name)}
          </span>
          <span className={styles.whoText}>
            <strong dir="auto">{account.name}</strong>
            {account.founder ? (
              <span className={styles.founder}>
                <Icon name="crown" />
                {t("Osnivač AhiBizza")}
              </span>
            ) : packageId ? (
              <span className={styles.package} data-package={packageId}>
                {t("Paket")} <b>{packageName(packageId)}</b>
              </span>
            ) : (
              account.owner && <span className={styles.role}>{t("Administrator")}</span>
            )}
          </span>
          <Icon name="chevron" className={rowStyles.chevron} />
        </Link>
      ) : (
        <div className={styles.guest}>
          <p>{t("Prijavi se da pratiš poruke, termine i svoje djelatnosti.")}</p>
          <div>
            <Link href="/prijava" className={styles.primary} prefetch={false}>
              {t("Prijava")}
            </Link>
            <Link href="/registracija" className={styles.secondary} prefetch={false}>
              {t("Registruj se")}
            </Link>
          </div>
        </div>
      )}
      {account && (
        <div className={styles.switch}>
          <AccountSwitch currentId={account.id} />
          {account.founder && !account.owner && (
            <Row
              icon="shield"
              title={t("Ulaz u administraciju")}
              href="/prijava?administracija=1"
            />
          )}
        </div>
      )}
      {groups.map((group) => (
        <RowGroup key={group.id} title={t(group.title)}>
          {group.rows.map((row) =>
            row.href ? (
              <Row
                key={row.label}
                icon={row.icon}
                title={t(row.label)}
                href={row.href}
                value={row.href === "/jezik" ? localeNames[locale] : undefined}
              />
            ) : (
              <Row
                key={row.label}
                icon={row.icon}
                title={t(row.label)}
                end={<RowPill kind="off">{t("Uskoro")}</RowPill>}
              />
            ),
          )}
        </RowGroup>
      ))}
      {account && (
        <div className={styles.leave}>
          <button type="button" disabled={leaving} onClick={() => void signOut()}>
            <Icon name="logout" />
            {t("Odjava")}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </main>
  );
}
