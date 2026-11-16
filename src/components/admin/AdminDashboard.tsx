"use client";

import Link from "next/link";
import { useState } from "react";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { BillingAdmin } from "../billing/BillingAdmin";
import { BusinessManager } from "../directory/BusinessManager";
import { Icon, type IconName } from "../Icon";
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
export function AdminDashboard({ initial }: { initial: SafeAccountProfile }) {
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("accounts");
  const [visited, setVisited] = useState({
    accounts: true,
    categories: false,
    businesses: false,
    billing: false,
  });
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
        <nav aria-label="Administratorski odjeljci">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              aria-controls="admin-content"
              onClick={() => {
                setVisited((previous) => ({ ...previous, [item.id]: true }));
                setSection(item.id);
              }}
            >
              <Icon name={item.icon} />
              {item.label}
              <Icon name="chevron" className={styles.chevron} />
            </button>
          ))}
        </nav>
        <Link className={styles.accountLink} href="/nalog">
          <Icon name="user" />
          Moj nalog
          <Icon name="arrow" />
        </Link>
      </aside>
      <section id="admin-content" className={styles.content}>
        <header className={styles.pageHeading}>
          <h1>{current.title}</h1>
        </header>
        <div hidden={section !== "accounts"}>
          {visited.accounts && (
            <AccountApprovals key={initial.id} expectedAccountId={initial.id} embedded />
          )}
        </div>
        <div hidden={section !== "categories"}>
          {visited.categories && (
            <CategoryManager key={initial.id} expectedAccountId={initial.id} />
          )}
        </div>
        <div hidden={section !== "businesses"}>
          {visited.businesses && (
            <BusinessManager
              key={initial.id}
              expectedAccountId={initial.id}
              active={section === "businesses"}
              isOwner
              initialAll
              embedded
            />
          )}
        </div>
        <div hidden={section !== "billing"}>
          {visited.billing && (
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
