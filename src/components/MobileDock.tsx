"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { accountSectionPath } from "../lib/account-return";
import { accountShortcuts } from "../lib/account-shortcuts";
import { headerCurrentDestination, type NavigationDestination } from "../lib/header-navigation";
import { msg } from "../lib/i18n/translate";
import { Icon } from "./Icon";
import { useT } from "./i18n/LocaleProvider";
import styles from "./mobile-dock.module.css";

const home = { href: "/", label: msg("Početna"), icon: "home" } as const;
const directory = { href: "/pretraga", label: msg("Pretraga"), icon: "search" } as const;
const messages = {
  href: accountSectionPath("messages"),
  label: msg("Poruke"),
  icon: "message",
} as const;
const publish = { href: accountShortcuts.newBusiness, label: msg("Objavi"), icon: "plus" } as const;
const account = { href: "/nalog", label: msg("Moj nalog"), icon: "user" } as const;
// Notifications open from the bell in the header; the dock carries search instead.
const destinations: NavigationDestination[] = [home, directory, publish, messages, account];

const sectionRoots = ["/pretraga", "/djelatnosti", "/ljudi", "/reels", "/blog", "/pomoc"];

export function MobileDock() {
  const t = useT();
  const pathname = usePathname();
  const search = useSearchParams();
  const query = new URLSearchParams(search?.toString());
  const current = headerCurrentDestination(pathname, query);
  const accountPane = pathname === "/nalog";
  const notificationsOpen = pathname === accountShortcuts.notifications;
  if (
    current === publish.href ||
    (pathname !== "/" &&
      !accountPane &&
      !notificationsOpen &&
      pathname !== accountShortcuts.savedSearches &&
      pathname !== accountShortcuts.blocked &&
      !sectionRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`)))
  )
    return null;
  const active =
    current === messages.href
      ? messages.href
      : accountPane ||
          notificationsOpen ||
          pathname === accountShortcuts.savedSearches ||
          pathname === accountShortcuts.blocked
        ? account.href
        : pathname === "/"
          ? home.href
          : current === directory.href
            ? directory.href
            : null;
  const activeIndex = destinations.findIndex(({ href }) => href === active);
  return (
    <nav className={styles.dock} aria-label={t("Glavna mobilna navigacija")} data-mobile-dock>
      {destinations.map(({ href, label, icon }) => (
        <Link
          href={href}
          key={href}
          prefetch={false}
          aria-current={active === href ? "page" : undefined}
          className={styles.link}
          data-publish={href === publish.href || undefined}
        >
          <span className={styles.glyph}>
            <Icon name={icon} />
          </span>
          <span>{t(label)}</span>
        </Link>
      ))}
      <span
        aria-hidden="true"
        className={styles.dot}
        data-visible={activeIndex >= 0 || undefined}
        style={{ "--dock-index": Math.max(activeIndex, 0) } as CSSProperties}
      />
    </nav>
  );
}
