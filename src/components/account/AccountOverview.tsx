"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import {
  type AccountOverviewFacts,
  readOverview,
  readPlacements,
} from "../../lib/account-overview";
import type { AccountSection } from "../../lib/account-return";
import { billingPackages } from "../../lib/billing";
import { accountDate } from "../../lib/display-date";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { PackageContract } from "../../lib/sandbox-subscriptions";
import { Icon, type IconName } from "../Icon";
import styles from "./overview.module.css";

type MemberContract = PackageContract & { contractualEndsAt: string | null };
const statuses: Record<PackageContract["status"], string> = {
  CREATING: "U pripremi",
  APPROVAL_PENDING: "Čeka odobrenje",
  APPROVED: "Odobrena",
  ACTIVE: "Aktivna",
  SUSPENDED: "Pauzirana",
  CANCELLED: "Otkazana",
  EXPIRED: "Završena",
};
function ownContracts(value: unknown, id: string): MemberContract[] {
  const data = value as { actor?: { id?: string }; contracts?: MemberContract[] } | null;
  if (
    !data ||
    data.actor?.id !== id ||
    !Array.isArray(data.contracts) ||
    !data.contracts.every(
      (row) =>
        row &&
        /^[a-f0-9-]{36}$/i.test(row.id) &&
        Object.hasOwn(statuses, row.status) &&
        billingPackages.some((plan) => plan.id === row.packageId) &&
        ["annual", "monthly"].includes(row.period) &&
        typeof row.businessTitle === "string" &&
        Number.isSafeInteger(row.paidCycles) &&
        row.paidCycles >= 0 &&
        [row.contractualEndsAt, row.endsAt].every(
          (date) =>
            date === null || (typeof date === "string" && Number.isFinite(Date.parse(date))),
        ),
    )
  )
    throw new Error("Invalid membership response");
  return data.contracts;
}

function useAccountRead<T>(
  path: string,
  expectedId: string,
  active: boolean,
  read: (body: unknown, id: string) => T,
) {
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retries repeat the same authenticated read.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError(false);
    async function load() {
      try {
        const response = await fetch(path, {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          mode: "same-origin",
          headers: { "X-AhiBizz-Account-ID": expectedId },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const next = read(await response.json(), expectedId);
        if (!controller.signal.aborted) setResult(next);
      } catch {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(true);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [expectedId, active, path, read, refresh]);
  return { result, error, retry: () => setRefresh((value) => value + 1) };
}

function ReadError({ retry }: { retry: () => void }) {
  return (
    <p role="status" className={styles.failure}>
      Podaci trenutno nisu dostupni.{" "}
      <button type="button" onClick={retry}>
        Pokušaj ponovo
      </button>
    </p>
  );
}

export function MembershipOverview({
  accountId,
  active,
  openPlans,
}: {
  accountId: string;
  active: boolean;
  openPlans?: () => void;
}) {
  const { result, error, retry } = useAccountRead(
    "/api/account/memberships",
    accountId,
    active,
    ownContracts,
  );
  const displayed = openPlans ? result?.slice(0, 2) : result;
  return (
    <section className={styles.contracts} aria-label="Moje pretplate">
      <header>
        <h2>Moje pretplate</h2>
        {openPlans && (!IS_PLAY_EDITION || Boolean(result?.length)) && (
          <button type="button" onClick={openPlans}>
            {IS_PLAY_EDITION ? "Pregled" : "Paketi"} <Icon name="arrow" />
          </button>
        )}
      </header>
      {error ? (
        <ReadError retry={retry} />
      ) : result?.length === 0 ? (
        <p className={styles.empty}>Još nemaš ugovoren paket.</p>
      ) : (
        displayed?.map((item) => (
          <article key={item.id} className={styles.contract}>
            <div className={styles.contractName}>
              <span className={styles.mark}>
                <Icon name="card" />
              </span>
              <div>
                <h3>
                  {billingPackages.find((plan) => plan.id === item.packageId)?.name} ·{" "}
                  {item.businessTitle}
                </h3>
                <p>
                  {item.period === "annual" ? "Godišnja uplata" : "Mjesečne uplate"} ·{" "}
                  {item.status === "ACTIVE" && !item.paidCycles
                    ? "Čeka uplatu"
                    : statuses[item.status]}
                </p>
              </div>
            </div>
            {(item.contractualEndsAt || item.endsAt) && (
              <dl>
                {item.contractualEndsAt && (
                  <div>
                    <dt>Ugovor do</dt>
                    <dd>
                      <time dateTime={item.contractualEndsAt}>
                        {accountDate(item.contractualEndsAt)}
                      </time>
                    </dd>
                  </div>
                )}
                {item.endsAt && (
                  <div>
                    <dt>Plaćeno do</dt>
                    <dd>
                      <time dateTime={item.endsAt}>{accountDate(item.endsAt)}</time>
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {!IS_PLAY_EDITION && (
              <Link
                className={styles.manage}
                href={`/paketi/placanje?paket=${item.packageId}&period=${item.period}&ugovor=${item.id}`}
              >
                Detalji ugovora <Icon name="chevron" />
              </Link>
            )}
          </article>
        ))
      )}
      {!error && result === null && (
        <span
          role="status"
          className={styles.placeholder}
          aria-label="Učitavanje pretplata"
          aria-busy="true"
        />
      )}
      {openPlans && result && result.length > 2 && (
        <button type="button" className={styles.manage} onClick={openPlans}>
          Sve pretplate <Icon name="arrow" />
        </button>
      )}
    </section>
  );
}

export function AccountOverview({
  accountId,
  active,
  onSection,
}: {
  accountId: string;
  active: boolean;
  onSection: (section: AccountSection) => void;
}) {
  const { result, error, retry } = useAccountRead(
    "/api/account/overview",
    accountId,
    active,
    readOverview,
  );
  return (
    <AccountSummary
      facts={result}
      onSection={onSection}
      error={error ? <ReadError retry={retry} /> : null}
    >
      <MembershipOverview
        accountId={accountId}
        active={active}
        openPlans={() => onSection("membership")}
      />
    </AccountSummary>
  );
}

export function AccountSummary({
  facts: result,
  onSection,
  error,
  children,
}: {
  facts: AccountOverviewFacts | null;
  onSection: (section: AccountSection) => void;
  error?: ReactNode;
  children?: ReactNode;
}) {
  const entries: {
    label: string;
    icon: IconName;
    count: number | undefined;
    pane: AccountSection;
  }[] = [
    { label: "Moje djelatnosti", icon: "shop", count: result?.businesses, pane: "businesses" },
    {
      label: "Nepročitani razgovori",
      icon: "message",
      count: result?.unreadThreads,
      pane: "messages",
    },
    {
      label: "Aktivna isticanja",
      icon: "star",
      count: result?.promotedBusinesses,
      pane: "advertising",
    },
    { label: "Ahi Credits", icon: "card", count: result?.credits, pane: "credits" },
  ];
  return (
    <div className={styles.workspace}>
      <header className={styles.masthead} data-design="account-summary">
        <div>
          <h1>Pregled naloga</h1>
          {result && (
            <p>
              Na AhiBizzu od <time dateTime={result.joinedAt}>{accountDate(result.joinedAt)}</time>
            </p>
          )}
        </div>
        <button type="button" onClick={() => onSection("profile")}>
          <Icon name="user" /> Moj profil
        </button>
      </header>
      {error}
      <div className={styles.metrics}>
        {entries.map(({ label, icon, count, pane }) => {
          const content = (
            <>
              <span className={styles.metricIcon}>
                <Icon name={icon} />
              </span>
              <strong>{count ?? "—"}</strong>
              <span>{label}</span>
            </>
          );
          return IS_PLAY_EDITION && pane === "credits" ? (
            <div className={styles.metric} key={pane} data-design="account-metric">
              {content}
            </div>
          ) : (
            <button
              type="button"
              className={styles.metric}
              data-design="account-metric"
              onClick={() => onSection(pane)}
              key={pane}
            >
              {content}
              <Icon name="chevron" className={styles.metricArrow} />
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** The Play edition displays previously acquired placements without creating a purchase. */
export function CurrentPlacements({ accountId, active }: { accountId: string; active: boolean }) {
  const { result, error, retry } = useAccountRead(
    "/api/account/placements",
    accountId,
    active,
    readPlacements,
  );
  return (
    <section className={styles.contracts}>
      <header>
        <h2>Moji oglasi</h2>
      </header>
      {error && <ReadError retry={retry} />}
      {result?.items.map((row) => (
        <article key={row.kind + row.id} className={styles.contract}>
          <h3>
            <Link href={`/djelatnosti/${row.id}`}>{row.title}</Link>
          </h3>
          <p>
            {
              {
                category: "Isticanje u kategoriji",
                featured: "Istaknuto na početnoj",
                nearby: "Istaknuto u blizini",
                banner: "Baner",
              }[row.kind]
            }{" "}
            · do <time dateTime={row.endsAt}>{accountDate(row.endsAt)}</time>
          </p>
        </article>
      ))}
      {result && !result.items.length && (
        <p className={styles.empty}>Trenutno nema aktivnih oglasa.</p>
      )}
      {!error && !result && (
        <span
          className={styles.placeholder}
          role="status"
          aria-label="Učitavanje oglasa"
          aria-busy="true"
        />
      )}
    </section>
  );
}
