"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { type AccountOverviewFacts, readOverview } from "../../lib/account-overview";
import type { AccountSection } from "../../lib/account-return";
import { accountDate } from "../../lib/display-date";
import { Icon, type IconName } from "../Icon";
import { BusinessToday } from "./BusinessToday";
import { NextAppointmentCard } from "./NextAppointmentCard";
import styles from "./overview.module.css";

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
      {result && result.businesses > 0 && (
        <BusinessToday key={accountId} accountId={accountId} active={active} />
      )}
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
      {result?.nextAppointment && (
        <NextAppointmentCard row={result.nextAppointment} open={() => onSection("appointments")} />
      )}
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
          return (
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
