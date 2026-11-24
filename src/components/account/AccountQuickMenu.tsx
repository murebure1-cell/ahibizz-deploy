"use client";

import Link from "next/link";
import { useState } from "react";
import { accountShortcuts as path } from "../../lib/account-shortcuts";
import type { Appearance } from "../../lib/appearance";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { HeaderMenuAccount } from "../../lib/header-access";
import type { NavigationDestination } from "../../lib/header-navigation";
import { msg } from "../../lib/i18n/translate";
import { forgetRememberedArea } from "../../lib/location-area-storage";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { useT } from "../i18n/LocaleProvider";
import styles from "./account-quick-menu.module.css";

const appearanceOptions = [
  ["system", msg("Uređaj")],
  ["light", msg("Svijetla")],
  ["dark", msg("Tamna")],
] as const;

export function AccountQuickMenu({
  account,
  currentHref,
  supportAvailable,
  close,
  confirmed,
}: {
  account: HeaderMenuAccount;
  currentHref: string | null;
  supportAvailable: boolean;
  close: () => void;
  confirmed: (next: HeaderMenuAccount) => void;
}) {
  const t = useT();
  const { setAppearance, resetAppearance } = useAppAppearance();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initials = account.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
  function link({ href, label, icon }: NavigationDestination, appearance?: string) {
    return (
      <Link
        key={href}
        href={href}
        prefetch={false}
        className={appearance ?? styles.row}
        aria-current={currentHref === href ? "page" : undefined}
        data-design="app-menu-item"
        onClick={close}
      >
        <Icon name={icon} />
        <span>{t(label)}</span>
        <Icon name="chevron" className={styles.chevron} />
      </Link>
    );
  }
  async function changeTheme(appearance: Appearance) {
    if (saving || appearance === account.appearance) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": account.id },
        body: JSON.stringify({ appearance, expectedAppearance: account.appearance }),
      });
      const payload = await response.json();
      if (
        !response.ok ||
        payload.account?.id !== account.id ||
        payload.account.appearance !== appearance
      )
        throw new Error("appearance");
      setAppearance(appearance);
      confirmed({ ...account, appearance });
    } catch {
      setError(t("Tema nije promijenjena. Otvori meni ponovo i pokušaj."));
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok || (await response.json()).ok !== true) throw new Error("logout");
      clearBrowserMessagingRecovery(account.id);
      forgetRememberedArea();
      resetAppearance();
      close();
      window.location.assign("/prijava");
    } catch {
      setError(t("Odjava nije uspjela. Pokušaj ponovo."));
      setSaving(false);
    }
  }
  return (
    <div className={styles.menu}>
      <Link href={path.profile} className={styles.profile} prefetch={false} onClick={close}>
        <span className={styles.avatar} aria-hidden="true">
          {initials || "A"}
        </span>
        <span className={styles.profileText}>
          <span>{t("Moj AhiBizz")}</span>
          <strong>{account.name}</strong>
        </span>
        <Icon name="arrow" />
      </Link>
      <div className={styles.tiles}>
        {link({ href: path.businesses, label: msg("Moje djelatnosti"), icon: "shop" }, styles.tile)}
        {link(
          { href: "/nalog?odjeljak=poruke", label: msg("Poruke"), icon: "message" },
          styles.tile,
        )}
      </div>
      <div className={styles.groups}>
        <details
          open={currentHref === path.appointments || currentHref === path.appointmentHistory}
        >
          <summary>
            <Icon name="calendar" />
            <span>{t("Termini")}</span>
            <Icon name="chevron" className={styles.chevron} />
          </summary>
          {link({ href: path.appointments, label: msg("Aktuelni termini"), icon: "calendar" })}
          {link({ href: path.appointmentHistory, label: msg("Historija termina"), icon: "clock" })}
        </details>
        <details
          open={
            currentHref === path.saved ||
            currentHref === path.savedSearches ||
            currentHref === "/blog?sacuvano=1"
          }
        >
          <summary>
            <Icon name="heart" />
            <span>{t("Sačuvano")}</span>
            <Icon name="chevron" className={styles.chevron} />
          </summary>
          {link({ href: path.saved, label: msg("Djelatnosti"), icon: "shop" })}
          {link({ href: path.savedSearches, label: msg("Pretrage"), icon: "search" })}
          {link({ href: "/blog?sacuvano=1", label: msg("Članci"), icon: "info" })}
        </details>
      </div>
      <div className={styles.publish}>
        {link({ href: path.newBusiness, label: msg("Dodaj djelatnost"), icon: "shop" })}
        {link({
          href: path.manageReels,
          label: msg("Objavi Reel"),
          icon: "play",
        })}
      </div>
      <div className={styles.links}>
        {link({ href: path.notifications, label: msg("Obavijesti"), icon: "bell" })}
        {link({ href: path.settings, label: msg("Postavke"), icon: "sliders" })}
        {link({ href: path.blocked, label: msg("Blokirani korisnici"), icon: "shield" })}
        {link({ href: "/pomoc", label: msg("Centar za pomoć"), icon: "message" })}
        {link({ href: "/blog", label: msg("AhiBizz blog"), icon: "info" })}
        {!IS_PLAY_EDITION &&
          supportAvailable &&
          link({ href: "/podrzi", label: msg("Doniraj"), icon: "heart" })}
      </div>
      <div className={styles.preferences}>
        <fieldset>
          <legend>{t("Izgled")}</legend>
          <div className={styles.themes}>
            {appearanceOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={account.appearance === value}
                disabled={saving}
                onClick={() => void changeTheme(value)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </fieldset>
        <LanguagePicker className={styles.language} />
        <button
          type="button"
          className={styles.logout}
          disabled={saving}
          onClick={() => void logout()}
        >
          <Icon name="external" /> {t("Odjavi se")}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
