"use client";

import Link from "next/link";
import { useState } from "react";
import { accountShortcuts as path } from "../../lib/account-shortcuts";
import type { Appearance } from "../../lib/appearance";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { HeaderMenuAccount } from "../../lib/header-access";
import type { NavigationDestination } from "../../lib/header-navigation";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { useAppAppearance } from "../appearance/AppAppearance";
import { Icon } from "../Icon";
import styles from "./account-quick-menu.module.css";

const number = new Intl.NumberFormat("bs-BA", { maximumFractionDigits: 2 });
const appearanceOptions = [
  ["system", "Uređaj"],
  ["light", "Svijetla"],
  ["dark", "Tamna"],
] as const;

export function AccountQuickMenu({
  account,
  currentHref,
  close,
  confirmed,
}: {
  account: HeaderMenuAccount;
  currentHref: string | null;
  close: () => void;
  confirmed: (next: HeaderMenuAccount) => void;
}) {
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
        className={appearance ?? styles.row}
        aria-current={currentHref === href ? "page" : undefined}
        data-design="app-menu-item"
        onClick={close}
      >
        <Icon name={icon} />
        <span>{label}</span>
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
      setError("Tema nije promijenjena. Otvori meni ponovo i pokušaj.");
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
      resetAppearance();
      close();
      window.location.assign("/prijava");
    } catch {
      setError("Odjava nije uspjela. Pokušaj ponovo.");
      setSaving(false);
    }
  }
  return (
    <div className={styles.menu}>
      <Link href={path.profile} className={styles.profile} onClick={close}>
        <span className={styles.avatar} aria-hidden="true">
          {initials || "A"}
        </span>
        <span className={styles.profileText}>
          <span>Moj AhiBizz</span>
          <strong>{account.name}</strong>
        </span>
        <Icon name="arrow" />
      </Link>
      {!IS_PLAY_EDITION && (
        <div className={styles.balance}>
          <Link href={path.credits} onClick={close}>
            <span>Ahi krediti</span>
            {account.balance !== null && <strong>{number.format(account.balance)}</strong>}
          </Link>
          <Link href={path.credits} className={styles.topup} onClick={close}>
            Dopuni <Icon name="arrow" />
          </Link>
        </div>
      )}
      <div className={styles.tiles}>
        {link({ href: path.businesses, label: "Moje djelatnosti", icon: "shop" }, styles.tile)}
        {link({ href: "/nalog?odjeljak=poruke", label: "Poruke", icon: "message" }, styles.tile)}
      </div>
      <div className={styles.groups}>
        <details
          open={currentHref === path.appointments || currentHref === path.appointmentHistory}
        >
          <summary>
            <Icon name="calendar" />
            <span>Termini i rezervacije</span>
            <Icon name="chevron" className={styles.chevron} />
          </summary>
          {link({ href: path.appointments, label: "Aktuelni termini", icon: "calendar" })}
          {link({ href: path.appointmentHistory, label: "Historija termina", icon: "clock" })}
        </details>
        {!IS_PLAY_EDITION && (
          <details
            open={
              currentHref === path.ads ||
              currentHref === path.scheduledAds ||
              currentHref === path.activeAds
            }
          >
            <summary>
              <Icon name="star" />
              <span>Promocije</span>
              <Icon name="chevron" className={styles.chevron} />
            </summary>
            {link({ href: path.ads, label: "Moji zahtjevi i oglasi", icon: "star" })}
            {link({ href: path.activeAds, label: "Aktivne promocije", icon: "check" })}
            {link({ href: path.scheduledAds, label: "Zakazane promocije", icon: "clock" })}
          </details>
        )}
        <details
          open={
            currentHref === path.saved ||
            currentHref === path.savedSearches ||
            currentHref === "/blog?sacuvano=1"
          }
        >
          <summary>
            <Icon name="heart" />
            <span>Sačuvano</span>
            <Icon name="chevron" className={styles.chevron} />
          </summary>
          {link({ href: path.saved, label: "Djelatnosti", icon: "shop" })}
          {link({ href: path.savedSearches, label: "Pretrage", icon: "search" })}
          {link({ href: "/blog?sacuvano=1", label: "Članci", icon: "info" })}
        </details>
      </div>
      <div className={styles.publish}>
        {link({ href: path.newBusiness, label: "Dodaj djelatnost", icon: "shop" })}
        {link({ href: path.manageReels, label: "Objavi Reel", icon: "play" })}
      </div>
      <div className={styles.links}>
        {link({ href: path.notifications, label: "Obavijesti", icon: "bell" })}
        {link({ href: path.settings, label: "Postavke", icon: "sliders" })}
        {link({ href: path.blocked, label: "Blokirani korisnici", icon: "shield" })}
        {link({ href: "/pomoc", label: "Centar za pomoć", icon: "message" })}
        {link({ href: "/blog", label: "AhiBizz blog", icon: "info" })}
        {!IS_PLAY_EDITION && link({ href: "/oglasavanje", label: "Oglašavanje", icon: "star" })}
        {!IS_PLAY_EDITION && link({ href: "/paketi", label: "Poslovni paketi", icon: "crown" })}
      </div>
      <div className={styles.preferences}>
        <fieldset>
          <legend>Izgled</legend>
          <div className={styles.themes}>
            {appearanceOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={account.appearance === value}
                disabled={saving}
                onClick={() => void changeTheme(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className={styles.logout}
          disabled={saving}
          onClick={() => void logout()}
        >
          <Icon name="external" /> Odjavi se
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
