"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useState } from "react";
import { type AccountOverviewFacts, readOverview } from "../../lib/account-overview";
import type { AccountSection } from "../../lib/account-return";
import { accountShortcuts } from "../../lib/account-shortcuts";
import { menuPath } from "../../lib/app-menu";
import { localDate } from "../../lib/display-date";
import { msg } from "../../lib/i18n/translate";
import { packageFullText, packageName } from "../../lib/packages";
import { type PersonalProfile, profileImageUrl } from "../../lib/people";
import { readPersonalProfile } from "../../lib/people-client";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { personalProfileImage, profileInitials } from "../people/PersonalProfileCard";
import { PlatformBadges } from "../people/PlatformBadges";
import { Row, RowPill, rowStyles } from "../ui/Rows";
import { VerificationBadge } from "../VerificationBadge";
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

/** The signed-in person's own profile; a profile of any other account is refused. */
function readOwnProfile(body: unknown, expectedId: string): PersonalProfile {
  if (!body || typeof body !== "object" || !("profile" in body))
    throw new Error("Invalid personal profile");
  const profile = readPersonalProfile(body.profile);
  if (profile.id !== expectedId) throw new Error("Invalid personal profile");
  return profile;
}

function ReadError({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return (
    <p role="status" className={styles.failure}>
      {t("Podaci trenutno nisu dostupni.")}{" "}
      <button type="button" onClick={retry}>
        {t("Pokušaj ponovo")}
      </button>
    </p>
  );
}

export function AccountOverview({
  accountId,
  name,
  administrator = false,
  profile,
  active,
  onSection,
  onAddBusiness,
  onProfile,
}: {
  accountId: string;
  name: string;
  administrator?: boolean;
  /** The profile the account area already holds, for example after an edit in its own pane. */
  profile?: PersonalProfile | null;
  active: boolean;
  onSection: (section: AccountSection) => void;
  onAddBusiness: () => void;
  onProfile?: (profile: PersonalProfile) => void;
}) {
  const { result, error, retry } = useAccountRead(
    "/api/account/overview",
    accountId,
    active,
    readOverview,
  );
  const own = useAccountRead("/api/people/me", accountId, active && !profile, readOwnProfile);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent callback is not part of the read.
  useEffect(() => {
    if (own.result) onProfile?.(own.result);
  }, [own.result]);
  return (
    <AccountSummary
      facts={result}
      name={name}
      administrator={administrator}
      profile={profile ?? own.result}
      onSection={onSection}
      onAddBusiness={onAddBusiness}
      error={error ? <ReadError retry={retry} /> : null}
    >
      {result && result.businesses > 0 && (
        <BusinessToday key={accountId} accountId={accountId} active={active} />
      )}
    </AccountSummary>
  );
}

const stateLabel = {
  draft: msg("Nacrt"),
  pending: msg("Na pregledu"),
  published: msg("Objavljeno"),
} as const;

/**
 * "Moj profil", the first screen after sign-in: who the person is, the businesses they keep and
 * the places of their account. Everything else is one tap away, in the menu.
 */
export function AccountSummary({
  facts,
  name,
  administrator = false,
  profile,
  onSection,
  onAddBusiness,
  error,
  children,
}: {
  facts: AccountOverviewFacts | null;
  name: string;
  administrator?: boolean;
  profile?: PersonalProfile | null;
  onSection: (section: AccountSection) => void;
  onAddBusiness: () => void;
  error?: ReactNode;
  children?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const numbers = new Intl.NumberFormat("de-DE");
  const businessesHeading = useId();
  const displayName = profile?.name ?? name;
  const photo = profile ? personalProfileImage(profileImageUrl(profile, "photo")) : null;
  const full =
    facts !== null && facts.businessLimit !== null && facts.businesses >= facts.businessLimit;
  const unread = facts?.unreadThreads ?? 0;
  return (
    <div className={styles.workspace}>
      <div className={styles.top}>
        <span>{t("Moj profil")}</span>
        <span className={styles.topActions}>
          <Link href={menuPath} className={styles.menu} aria-label={t("Meni")} prefetch={false}>
            <Icon name="menu" />
          </Link>
        </span>
      </div>
      <header className={styles.head} data-design="account-summary">
        {/* As drawn, the photo itself opens Uredi profil. */}
        <button
          type="button"
          className={styles.avatar}
          data-founder={profile?.platformFounder ? "" : undefined}
          aria-label={t("Uredi profil")}
          onClick={() => onSection("profile")}
        >
          {photo ? (
            <Image src={photo} alt="" width={176} height={176} unoptimized />
          ) : (
            <span aria-hidden="true">{profileInitials(displayName)}</span>
          )}
        </button>
        <h1>
          <bdi>{displayName}</bdi>
          {profile?.verified && <VerificationBadge kind="person" />}
        </h1>
        {profile && (
          <PlatformBadges
            platformFounder={profile.platformFounder}
            platformAdministrator={profile.platformAdministrator}
          />
        )}
        <div className={styles.tags}>
          {facts?.package && (
            <span className={styles.package} data-package={facts.package}>
              {t("Paket")} <strong>{packageName(facts.package)}</strong>
            </span>
          )}
          {!profile && administrator && (
            <span className={styles.package}>{t("Administrator")}</span>
          )}
          {facts && (
            <span className={styles.since}>
              {t("od")} <time dateTime={facts.joinedAt}>{localDate(facts.joinedAt, locale)}</time>
            </span>
          )}
        </div>
      </header>
      {facts && (
        // As drawn, the numbers open "Analitika".
        <div className={styles.stats}>
          <Link href="/nalog/analitika" prefetch={false}>
            <strong>{numbers.format(facts.profileViews ?? 0)}</strong>
            <span>{t("Pregledi profila · 30 dana")}</span>
          </Link>
          <Link href="/nalog/analitika" prefetch={false}>
            <strong>{numbers.format(facts.businessViews ?? 0)}</strong>
            <span>{t("Pregledi djelatnosti · 30 dana")}</span>
          </Link>
        </div>
      )}
      <div className={styles.pair}>
        <button type="button" onClick={() => onSection("connections")}>
          <Icon name="people" />
          <span>{t("Prijatelji")}</span>
          {typeof facts?.friends === "number" && <small>{numbers.format(facts.friends)}</small>}
        </button>
        <button type="button" onClick={() => onSection("saved")}>
          <Icon name="heart" />
          <span>{t("Sačuvano")}</span>
        </button>
      </div>
      {error}
      {facts?.nextAppointment && (
        <NextAppointmentCard row={facts.nextAppointment} open={() => onSection("appointments")} />
      )}
      <section className={styles.businesses} aria-labelledby={businessesHeading}>
        <header className={styles.blockHead}>
          <h2 id={businessesHeading}>{t("Moje djelatnosti")}</h2>
          <span className={styles.count}>
            {facts &&
              (facts.businessLimit
                ? t("{count} od {limit}", { count: facts.businesses, limit: facts.businessLimit })
                : facts.businesses)}
          </span>
          {facts && !full && (
            <button
              type="button"
              className={styles.add}
              aria-label={t("Dodaj djelatnost")}
              onClick={onAddBusiness}
            >
              <Icon name="plus" /> {t("Dodaj")}
            </button>
          )}
        </header>
        {facts && (
          <div className={styles.block}>
            {facts.businessList.length > 0 && (
              <ul className={styles.rows}>
                {facts.businessList.map((business) => (
                  <li key={business.id}>
                    <button type="button" onClick={() => onSection("businesses")}>
                      <span
                        className={styles.rowMark}
                        data-live={business.status === "published" || undefined}
                        aria-hidden="true"
                      >
                        {profileInitials(business.title)}
                      </span>
                      <span className={styles.rowTitle} dir="auto">
                        {business.title}
                      </span>
                      <span className={styles.state} data-state={business.status}>
                        {t(stateLabel[business.status])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {facts.businesses > facts.businessList.length && (
              <button type="button" className={styles.all} onClick={() => onSection("businesses")}>
                {t("Sve djelatnosti")} <Icon name="chevron" />
              </button>
            )}
            {facts.businesses === 0 && (
              <p className={styles.note}>
                {t("Još nemaš djelatnost. Dodaj je da te ljudi pronađu u pretrazi.")}
              </p>
            )}
            {full && <p className={styles.note}>{t(packageFullText)}</p>}
          </div>
        )}
      </section>
      <nav className={`${rowStyles.card} ${styles.links}`} aria-label={t("Moj nalog")}>
        <Row
          icon="message"
          title={t("Poruke")}
          onClick={() => onSection("messages")}
          end={
            unread > 0 ? (
              <span className={rowStyles.count}>
                <span className={styles.srOnly}>{t("Nepročitani razgovori")} </span>
                {unread}
              </span>
            ) : undefined
          }
        />
        <Row icon="calendar" title={t("Termini")} onClick={() => onSection("appointments")} />
        <Row icon="play" title={t("Moji reels")} href={accountShortcuts.manageReels} />
        <Row
          icon="layers"
          title={t("Sponzorisano")}
          end={<RowPill kind="off">{t("Uskoro")}</RowPill>}
        />
      </nav>
      {children}
    </div>
  );
}
