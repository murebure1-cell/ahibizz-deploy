"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AdminSection,
  adminSectionPath,
  businessImportPath,
  businessLocationBatchPath,
  readAdminNavigation,
} from "../../lib/admin-navigation";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { BillingAdmin } from "../billing/BillingAdmin";
import { BusinessManager } from "../directory/BusinessManager";
import { Icon, type IconName } from "../Icon";
import { ReviewsAdmin } from "../reviews/ReviewsAdmin";
import { AccountApprovals } from "./AccountApprovals";
import styles from "./admin.module.css";
import { CategoryManager } from "./CategoryManager";

const sections = [
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
  {
    id: "billing",
    label: "Naplata i razvoj",
    icon: "shop",
    title: "Naplata i razvoj",
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
  initialSection = "accounts",
}: {
  initial: SafeAccountProfile;
  initialSection?: AdminSection;
}) {
  const searchParams = useSearchParams();
  const query = searchParams?.toString();
  const section = useMemo(
    () => (query === undefined ? initialSection : readAdminNavigation(new URLSearchParams(query))),
    [query, initialSection],
  );
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [visited, setVisited] = useState({
    accounts: section === "accounts",
    categories: section === "categories",
    businesses: section === "businesses",
    billing: section === "billing",
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
  const current = sections.find((item) => item.id === section) ?? sections[0];
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
              aria-current={section === item.id ? "page" : undefined}
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
              <Link href="/administracija/oglasi">
                <Icon name="star" /> Oglašavanje i krediti
              </Link>
            )}
            <Link href="/administracija/izgled">
              <Icon name="sliders" /> Uređivač izgleda
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
          <h1 data-design="admin-heading">{current.title}</h1>
          {section === "businesses" && (
            <div className={styles.headingActions}>
              <Link href={businessImportPath}>Uvezi prijave</Link>
              <Link href={businessLocationBatchPath}>Lokacije</Link>
            </div>
          )}
        </header>
        <div hidden={section !== "accounts"}>
          {(visited.accounts || section === "accounts") && (
            <AccountApprovals
              key={initial.id}
              expectedAccountId={initial.id}
              active={section === "accounts"}
              embedded
            />
          )}
        </div>
        <div hidden={section !== "categories"}>
          {(visited.categories || section === "categories") && (
            <CategoryManager key={initial.id} expectedAccountId={initial.id} />
          )}
        </div>
        <div hidden={section !== "businesses"}>
          {(visited.businesses || section === "businesses") && (
            <BusinessManager
              key={initial.id}
              expectedAccountId={initial.id}
              active={section === "businesses"}
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
        <div hidden={section !== "billing"}>
          {(visited.billing || section === "billing") && (
            <BillingAdmin
              key={initial.id}
              expectedAccountId={initial.id}
              active={section === "billing"}
              embedded
            />
          )}
        </div>
      </section>
    </main>
  );
}
