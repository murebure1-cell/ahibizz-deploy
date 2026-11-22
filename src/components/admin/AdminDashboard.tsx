"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AdminSection,
  adminMailPath,
  adminSectionPath,
  businessImportPath,
  businessLocationBatchPath,
  readAdminNavigation,
} from "../../lib/admin-navigation";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { BusinessManager } from "../directory/BusinessManager";
import { Icon, type IconName } from "../Icon";
import { ReviewsAdmin } from "../reviews/ReviewsAdmin";
import { AccountApprovals } from "./AccountApprovals";
import { AdminToday } from "./AdminToday";
import styles from "./admin.module.css";
import { CategoryManager } from "./CategoryManager";

const sections = [
  { id: "today", label: "Danas", icon: "calendar", title: "Danas" },
  {
    id: "accounts",
    label: "Nalozi",
    icon: "user",
    title: "Nalozi",
  },
  {
    id: "categories",
    label: "Kategorije",
    icon: "sliders",
    title: "Kategorije",
  },
  {
    id: "businesses",
    label: "Djelatnosti",
    icon: "shop",
    title: "Djelatnosti",
  },
  {
    id: "reviews",
    label: "Recenzije",
    icon: "star",
    title: "Recenzije",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
  title: string;
}[];

/** The server page authorizes access; each endpoint independently checks the current owner. */
export function AdminDashboard({
  initial,
  initialSection = "today",
}: {
  initial: SafeAccountProfile;
  initialSection?: AdminSection;
}) {
  const searchParams = useSearchParams();
  const query = searchParams?.toString();
  const section = useMemo(() => {
    const target =
      query === undefined ? initialSection : readAdminNavigation(new URLSearchParams(query));
    return target;
  }, [query, initialSection]);
  // Preserve mounted workspaces on unrelated tab changes; a focused queue explicitly starts a new filtered view.
  const [lastQueue, setLastQueue] = useState({
    accounts: false,
    businesses: false,
  });
  const accountsActive = section === "accounts" || section === "approvalQueue";
  const businessesActive = section === "businesses" || section === "businessQueue";
  const accountsQueue = accountsActive ? section === "approvalQueue" : lastQueue.accounts;
  const businessesQueue = businessesActive ? section === "businessQueue" : lastQueue.businesses;
  useEffect(() => {
    setLastQueue((last) =>
      last.accounts === accountsQueue && last.businesses === businessesQueue
        ? last
        : { accounts: accountsQueue, businesses: businessesQueue },
    );
  }, [accountsQueue, businessesQueue]);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [visited, setVisited] = useState({
    today: section === "today",
    approvalQueue: section === "approvalQueue",
    businessQueue: section === "businessQueue",
    accounts: section === "accounts",
    categories: section === "categories",
    businesses: section === "businesses",
    reviews: section === "reviews",
  });
  useEffect(() => {
    setVisited((previous) => (previous[section] ? previous : { ...previous, [section]: true }));
  }, [section]);
  function changeSection(next: AdminSection) {
    const href = adminSectionPath(next);
    setVisited((previous) => (previous[next] ? previous : { ...previous, [next]: true }));
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href)
      window.history.pushState(null, "", href);
    if (navigationOpen && navigationToggle.current?.getClientRects().length) {
      navigationToggle.current.focus({ preventScroll: true });
    }
    setNavigationOpen(false);
  }
  const queues = {
    approvalQueue: { parent: "accounts", title: "Nalozi za odobrenje" },
    businessQueue: { parent: "businesses", title: "Djelatnosti i izmjene za pregled" },
  } as const;
  const queue = Object.hasOwn(queues, section) ? queues[section as keyof typeof queues] : null;
  const current = sections.find((item) => item.id === (queue?.parent ?? section)) ?? sections[0];
  return (
    <main id="glavni-sadrzaj" className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.identity}>
          <span aria-hidden="true">
            <Icon name="sliders" />
          </span>
          <div>
            <strong>Administracija</strong>
            <small>{initial.name}</small>
          </div>
        </div>
        <button
          className={styles.navigationToggle}
          ref={navigationToggle}
          type="button"
          aria-expanded={navigationOpen}
          aria-controls="admin-navigation"
          onClick={() => setNavigationOpen(!navigationOpen)}
        >
          <Icon name="menu" /> Odjeljci
        </button>
        <nav
          id="admin-navigation"
          data-expanded={navigationOpen}
          aria-label="Administratorski odjeljci"
        >
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              data-admin-section={item.id}
              aria-current={current.id === item.id ? "page" : undefined}
              aria-controls="admin-content"
              onClick={() => changeSection(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
              <Icon name="chevron" className={styles.chevron} />
            </button>
          ))}
          <section aria-label="Alati" className={styles.toolsGroup}>
            <span className={styles.toolsLabel} aria-hidden="true">
              Alati
            </span>
            <Link href="/administracija/zahtjevi">
              <Icon name="message" /> Zahtjevi i prijave
            </Link>
            {!IS_PLAY_EDITION && (
              <Link href="/administracija/isticanja">
                <Icon name="star" /> Isticanja
              </Link>
            )}
            <Link href="/administracija/reels">
              <Icon name="play" /> Pregled Reelsa
            </Link>
            <Link href="/administracija/blog">
              <Icon name="info" /> Uređivanje bloga
            </Link>
            <Link href="/administracija/izgled">
              <Icon name="sliders" /> Uređivač izgleda
            </Link>
            <Link href={adminMailPath}>
              <Icon name="mail" /> Email poruke
            </Link>
          </section>
        </nav>
        <Link className={styles.accountLink} href="/nalog">
          <Icon name="user" />
          Moj nalog
          <Icon name="arrow" />
        </Link>
      </aside>
      <section id="admin-content" className={styles.content} data-design="admin-panel">
        <header className={styles.pageHeading}>
          <h1 data-design="admin-heading">{queue?.title ?? current.title}</h1>
          {section === "businesses" && (
            <div className={styles.headingActions}>
              <Link href={businessImportPath}>Uvezi prijave</Link>
              <Link href={businessLocationBatchPath}>Lokacije</Link>
            </div>
          )}
        </header>
        {section === "today" && <AdminToday key={initial.id} accountId={initial.id} />}
        <div hidden={!accountsActive}>
          {(visited.accounts || visited.approvalQueue || accountsActive) && (
            <AccountApprovals
              key={`${initial.id}:${accountsQueue}`}
              expectedAccountId={initial.id}
              readyOnly={accountsQueue}
              active={accountsActive}
              embedded
            />
          )}
        </div>
        <div hidden={section !== "categories"}>
          {(visited.categories || section === "categories") && (
            <CategoryManager key={initial.id} expectedAccountId={initial.id} />
          )}
        </div>
        <div hidden={!businessesActive}>
          {(visited.businesses || visited.businessQueue || businessesActive) && (
            <BusinessManager
              key={`${initial.id}:${businessesQueue}`}
              expectedAccountId={initial.id}
              initialReview={businessesQueue}
              active={businessesActive}
              isOwner
              initialAll
              adminVerification
              embedded
            />
          )}
        </div>
        <div hidden={section !== "reviews"}>
          {(visited.reviews || section === "reviews") && (
            <ReviewsAdmin
              key={initial.id}
              expectedAccountId={initial.id}
              active={section === "reviews"}
            />
          )}
        </div>
      </section>
    </main>
  );
}
