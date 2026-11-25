"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useState } from "react";
import { type AccountOverviewFacts, readOverview } from "../../lib/account-overview";
import type { AccountSection } from "../../lib/account-return";
import { localDate } from "../../lib/display-date";
import { msg } from "../../lib/i18n/translate";
import { packageFullText, packageName } from "../../lib/packages";
import { type PersonalProfile, profileImageUrl } from "../../lib/people";
import { readPersonalProfile } from "../../lib/people-client";
import { Icon, type IconName } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { personalProfileImage, profileInitials } from "../people/PersonalProfileCard";
import { PlatformBadges } from "../people/PlatformBadges";
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
  onSignOut,
  signingOut,
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
  onSignOut?: () => void;
  signingOut?: boolean;
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
      onSignOut={onSignOut}
      signingOut={signingOut}
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

/** The first screen after sign-in: who the person is, what they keep, and where to go next. */
export function AccountSummary({
  facts,
  name,
  administrator = false,
  profile,
  onSection,
  onAddBusiness,
  onSignOut,
  signingOut = false,
  error,
  children,
}: {
  facts: AccountOverviewFacts | null;
  name: string;
  administrator?: boolean;
  profile?: PersonalProfile | null;
  onSection: (section: AccountSection) => void;
  onAddBusiness: () => void;
  /** On a phone the overview hides the sidebar's identity row, so signing out lives here. */
  onSignOut?: () => void;
  signingOut?: boolean;
  error?: ReactNode;
  children?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const businessesHeading = useId();
  const displayName = profile?.name ?? name;
  const photo = profile ? personalProfileImage(profileImageUrl(profile, "photo")) : null;
  const cover = profile ? personalProfileImage(profileImageUrl(profile, "cover")) : null;
  const full =
    facts !== null && facts.businessLimit !== null && facts.businesses >= facts.businessLimit;
  const shortcuts: { label: string; icon: IconName; pane: AccountSection; count?: number }[] = [
    { label: t("Poruke"), icon: "message", pane: "messages", count: facts?.unreadThreads },
    { label: t("Moji termini"), icon: "calendar", pane: "appointments" },
    { label: t("Sačuvane djelatnosti"), icon: "heart", pane: "saved" },
    { label: t("Postavke"), icon: "sliders", pane: "settings" },
  ];
  return (
    <div className={styles.workspace}>
      <header className={styles.head} data-design="account-summary">
        <div className={styles.cover} data-plain={cover ? undefined : true}>
          {cover && (
            <Image
              src={cover}
              alt=""
              width={1600}
              height={600}
              unoptimized
              className={styles.coverImage}
            />
          )}
        </div>
        <div className={styles.headBody}>
          <span className={styles.avatar}>
            {photo ? (
              <Image src={photo} alt="" width={160} height={160} unoptimized />
            ) : (
              <span aria-hidden="true">{profileInitials(displayName)}</span>
            )}
          </span>
          <div className={styles.who}>
            <h1>
              <bdi>{displayName}</bdi>
              {profile?.verified && <VerificationBadge kind="person" />}
            </h1>
            <div className={styles.tags}>
              {facts?.package && (
                <span className={styles.package} data-package={facts.package}>
                  {t("Paket")} <strong>{packageName(facts.package)}</strong>
                </span>
              )}
              {profile ? (
                <PlatformBadges
                  platformFounder={profile.platformFounder}
                  platformAdministrator={profile.platformAdministrator}
                />
              ) : (
                administrator && <span className={styles.package}>{t("Administrator")}</span>
              )}
            </div>
            {facts && (
              <p className={styles.since}>
                {t("Na AhiBizzu od")}{" "}
                <time dateTime={facts.joinedAt}>{localDate(facts.joinedAt, locale)}</time>
              </p>
            )}
          </div>
          <button type="button" className={styles.edit} onClick={() => onSection("profile")}>
            <Icon name="user" /> {t("Uredi profil")}
          </button>
        </div>
      </header>
      {error}
      {facts?.nextAppointment && (
        <NextAppointmentCard row={facts.nextAppointment} open={() => onSection("appointments")} />
      )}
      <section className={styles.block} aria-labelledby={businessesHeading}>
        <header className={styles.blockHead}>
          <h2 id={businessesHeading}>{t("Moje djelatnosti")}</h2>
          {facts && (
            <span className={styles.count}>
              {facts.businessLimit
                ? t("{count} od {limit}", { count: facts.businesses, limit: facts.businessLimit })
                : facts.businesses}
            </span>
          )}
          {facts && !full && (
            <button type="button" className={styles.add} onClick={onAddBusiness}>
              <Icon name="plus" /> {t("Dodaj djelatnost")}
            </button>
          )}
        </header>
        {facts && facts.businessList.length > 0 && (
          <ul className={styles.rows}>
            {facts.businessList.map((business) => (
              <li key={business.id}>
                <button type="button" onClick={() => onSection("businesses")}>
                  <span className={styles.rowMark} aria-hidden="true">
                    <Icon name="shop" />
                  </span>
                  <span className={styles.rowTitle} dir="auto">
                    {business.title}
                  </span>
                  <span className={styles.state} data-state={business.status}>
                    {t(stateLabel[business.status])}
                  </span>
                  <Icon name="chevron" className={styles.rowArrow} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {facts && facts.businesses > facts.businessList.length && (
          <button type="button" className={styles.all} onClick={() => onSection("businesses")}>
            {t("Sve djelatnosti")} <Icon name="chevron" />
          </button>
        )}
        {facts && facts.businesses === 0 && (
          <p className={styles.note}>
            {t("Još nemaš djelatnost. Dodaj je da te ljudi pronađu u pretrazi.")}
          </p>
        )}
        {full && <p className={styles.note}>{t(packageFullText)}</p>}
      </section>
      <nav className={styles.block} aria-label={t("Moj nalog")}>
        <ul className={styles.rows}>
          {shortcuts.map(({ label, icon, pane, count }) => (
            <li key={pane}>
              <button type="button" data-design="account-metric" onClick={() => onSection(pane)}>
                <span className={styles.rowMark} aria-hidden="true">
                  <Icon name={icon} />
                </span>
                <span className={styles.rowTitle}>{label}</span>
                {count !== undefined && count > 0 && (
                  <span className={styles.badge}>
                    <span className={styles.srOnly}>{t("Nepročitani razgovori")} </span>
                    {count}
                  </span>
                )}
                <Icon name="chevron" className={styles.rowArrow} />
              </button>
            </li>
          ))}
          <li>
            <Link href="/pomoc" data-design="account-metric">
              <span className={styles.rowMark} aria-hidden="true">
                <Icon name="info" />
              </span>
              <span className={styles.rowTitle}>{t("Pomoć")}</span>
              <Icon name="chevron" className={styles.rowArrow} />
            </Link>
          </li>
          {onSignOut && (
            <li className={styles.signOut}>
              <button type="button" disabled={signingOut} onClick={onSignOut}>
                <span className={styles.rowMark} aria-hidden="true">
                  <Icon name="logout" />
                </span>
                <span className={styles.rowTitle}>{t("Odjava")}</span>
              </button>
            </li>
          )}
        </ul>
      </nav>
      {children}
    </div>
  );
}
