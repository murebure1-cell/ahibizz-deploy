"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { accountSectionPath } from "../lib/account-return";
import { accountShortcuts } from "../lib/account-shortcuts";
import { headerCurrentDestination, type NavigationDestination } from "../lib/header-navigation";
import { Icon } from "./Icon";
import styles from "./mobile-dock.module.css";

const home = { href: "/", label: "Početna", icon: "home" } as const;
const messages = {
  href: accountSectionPath("messages"),
  label: "Poruke",
  icon: "message",
} as const;
const publish = { href: accountShortcuts.newBusiness, label: "Objavi", icon: "plus" } as const;
const notifications = {
  href: accountShortcuts.notifications,
  label: "Obavijesti",
  icon: "bell",
} as const;
const account = { href: "/nalog", label: "Moj nalog", icon: "user" } as const;
const destinations: NavigationDestination[] = [home, messages, publish, notifications, account];

const sectionRoots = ["/pretraga", "/djelatnosti", "/ljudi", "/reels", "/blog", "/pomoc"];

export function MobileDock() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = new URLSearchParams(search?.toString());
  const current = headerCurrentDestination(pathname, query);
  const accountPane = pathname === "/nalog";
  const financialPane =
    accountPane && ["krediti", "oglasi", "paketi"].includes(query.get("odjeljak") ?? "");
  const notificationsOpen = pathname === accountShortcuts.notifications;
  if (
    financialPane ||
    current === publish.href ||
    (pathname !== "/" &&
      !accountPane &&
      !notificationsOpen &&
      pathname !== accountShortcuts.savedSearches &&
      pathname !== accountShortcuts.blocked &&
      !sectionRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`)))
  )
    return null;
  const active = notificationsOpen
    ? notifications.href
    : current === messages.href
      ? messages.href
      : accountPane ||
          pathname === accountShortcuts.savedSearches ||
          pathname === accountShortcuts.blocked
        ? account.href
        : pathname === "/"
          ? home.href
          : null;
  return (
    <nav className={styles.dock} aria-label="Glavna mobilna navigacija" data-mobile-dock>
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
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
