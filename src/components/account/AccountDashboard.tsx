"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type AccountSection,
  accountSectionPath,
  readAccountNavigation,
} from "../../lib/account-return";
import { accountShortcuts } from "../../lib/account-shortcuts";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { msg } from "../../lib/i18n/translate";
import { forgetRememberedArea } from "../../lib/location-area-storage";
import type { MessageTarget } from "../../lib/messaging";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { type PersonalProfile, profileImageUrl } from "../../lib/people";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useAppAppearance } from "../appearance/AppAppearance";
import { SavedBusinesses } from "../favorites/SavedBusinesses";
import { Icon, type IconName } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { PersonalProfileWorkspace } from "../people/PersonalProfileWorkspace";
import { CommunityRulesPrompt } from "../support/CommunityRulesPrompt";
import { ScreenBar } from "../ui/Rows";
import { AccountAuthorityBoundary } from "./AccountAuthorityBoundary";
import { AccountOverview } from "./AccountOverview";
import { AccountSettings } from "./AccountSettings";
import styles from "./account.module.css";

function PaneHeading({ label }: { label: string }) {
  const t = useT();
  return (
    <h2 className={styles.paneHeading} aria-busy="true">
      {t(label)}
    </h2>
  );
}
const paneHeading = (label: string) => <PaneHeading label={label} />;
const OwnerCalendarPanel = dynamic(() =>
  import("./OwnerCalendarPanel").then((m) => m.OwnerCalendarPanel),
);
const BusinessManager = dynamic(
  () => import("../directory/BusinessManager").then((m) => m.BusinessManager),
  { loading: () => paneHeading(msg("Djelatnosti")) },
);
const MessagingInbox = dynamic(
  () => import("../messaging/MessagingInbox").then((m) => m.MessagingInbox),
  { loading: () => paneHeading(msg("Poruke")) },
);
const CustomerAppointments = dynamic(
  () => import("../booking/CustomerAppointments").then((m) => m.CustomerAppointments),
  { loading: () => paneHeading(msg("Moji termini")) },
);
const ConnectionsPanel = dynamic(
  () => import("../connections/ConnectionsPanel").then((m) => m.ConnectionsPanel),
  { loading: () => paneHeading(msg("Prijatelji")) },
);
const accountMenu = [
  { id: "overview", label: msg("Pregled"), icon: "home", primary: true },
  { id: "businesses", label: msg("Djelatnosti"), icon: "shop", primary: true },
  { id: "messages", label: msg("Poruke"), icon: "message", primary: true },
  { id: "profile", label: msg("Moj profil"), icon: "user", group: msg("Lični nalog") },
  { id: "appointments", label: msg("Moji termini"), icon: "calendar", group: msg("Lični nalog") },
  { id: "connections", label: msg("Prijatelji"), icon: "people", group: msg("Lični nalog") },
  { id: "saved", label: msg("Sačuvane djelatnosti"), icon: "heart", group: msg("Lični nalog") },
  { id: "settings", label: msg("Postavke"), icon: "sliders", group: msg("Lični nalog") },
] as {
  id: AccountSection;
  label: string;
  icon: IconName;
  primary?: boolean;
  digital?: boolean;
  group?: "Lični nalog" | "Poslovanje";
}[];

// Mount a workspace on first visit, then keep drafts and pending commands across pane switches.
function AccountPane({ selected, children }: { selected: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(selected);
  useEffect(() => {
    if (selected) setVisited(true);
  }, [selected]);
  if (!visited && !selected) return null;
  return <div hidden={!selected}>{children}</div>;
}

type AccountDashboardProps = {
  initial: SafeAccountProfile;
  initialSection?: AccountSection;
  messageTarget?: MessageTarget;
  invalidMessageTarget?: boolean;
};
export function AccountDashboard(props: AccountDashboardProps) {
  return <AccountWorkspace key={`${props.initial.id}:${props.initial.role}`} {...props} />;
}
function AccountWorkspace({
  initial,
  initialSection = "overview",
  messageTarget,
  invalidMessageTarget = false,
}: AccountDashboardProps) {
  const t = useT();
  const [profile, setProfile] = useState(initial),
    [personal, setPersonal] = useState<PersonalProfile | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const searchParams = useSearchParams();
  const { setAppearance, resetAppearance } = useAppAppearance();
  useEffect(() => {
    if (initial.id) setAppearance(initial.appearance);
  }, [initial.id, initial.appearance, setAppearance]);
  const query = searchParams?.toString();
  const moreControl = useRef<HTMLButtonElement>(null);
  const [moreMenu, setMoreMenu] = useState(false);
  const view = useMemo<ReturnType<typeof readAccountNavigation>>(
    () =>
      query === undefined
        ? { section: initialSection, messageTarget, invalidMessageTarget }
        : readAccountNavigation(new URLSearchParams(query)),
    [query, initialSection, messageTarget, invalidMessageTarget],
  );
  const section = view.section;
  const focusNotifications =
    section === "settings" &&
    searchParams?.getAll("prikaz").length === 1 &&
    searchParams.get("prikaz") === "obavijesti";
  const startBusinessCreation =
    section === "businesses" &&
    searchParams?.getAll("novo").length === 1 &&
    searchParams.get("novo") === "1";
  const returnPath = focusNotifications
    ? accountShortcuts.notificationSettings
    : startBusinessCreation
      ? accountShortcuts.newBusiness
      : accountSectionPath(section);
  const photo = personal ? profileImageUrl(personal, "photo") : null;
  const menu = accountMenu.filter((item) => !IS_PLAY_EDITION || !item.digital);
  const current = menu.find((item) => item.id === section);
  function changeSection(next: AccountSection) {
    const href = accountSectionPath(next);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href)
      window.history.pushState(null, "", href);
    setError("");
    if (moreMenu && moreControl.current?.getClientRects().length)
      moreControl.current.focus({ preventScroll: true });
    setMoreMenu(false);
  }
  function addBusiness() {
    const href = accountShortcuts.newBusiness;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href)
      window.history.pushState(null, "", href);
    setError("");
  }
  function tab(item: (typeof accountMenu)[number]) {
    return (
      <button
        key={item.id}
        type="button"
        data-account-section={item.id}
        aria-current={section === item.id ? "page" : undefined}
        aria-controls="account-panel"
        onClick={() => changeSection(item.id)}
      >
        <Icon name={item.icon} />
        <span>{t(item.label)}</span>
      </button>
    );
  }
  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setError(t("Odjava nije uspjela. Pokušaj ponovo."));
        return;
      }
      clearBrowserMessagingRecovery(initial.id);
      forgetRememberedArea();
      resetAppearance();
      window.location.assign("/prijava");
    } catch {
      setError(t("Odjava nije uspjela. Pokušaj ponovo."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountAuthorityBoundary
      expectedAccountId={initial.id}
      expectedRole={initial.role}
      loginHref={`/prijava?nastavi=${encodeURIComponent(returnPath)}`}
      onConfirmed={setProfile}
    >
      {(hasAccess) => (
        <main id="glavni-sadrzaj" className={styles.layout} data-account-pane={section}>
          <aside className={styles.sidebar} data-design="account-sidebar">
            <div className={styles.identity}>
              <span aria-hidden="true">
                {photo ? (
                  <Image
                    src={photo}
                    alt=""
                    width={43}
                    height={43}
                    unoptimized
                    style={{
                      borderRadius: "inherit",
                      objectFit: "cover",
                      width: "100%",
                      height: "100%",
                    }}
                  />
                ) : (
                  profile.name.slice(0, 1).toLocaleUpperCase("bs")
                )}
              </span>
              <div>
                <strong dir="auto">{profile.name}</strong>
                <small>{profile.role === "owner" ? t("Administrator") : t("Moj AhiBizz")}</small>
              </div>
            </div>
            <div className={styles.navigationViewport}>
              <nav aria-label={t("Moj nalog")}>
                {menu.filter((item) => item.primary).map(tab)}
                <button
                  ref={moreControl}
                  type="button"
                  className={styles.moreControl}
                  data-current={Boolean(current && !current.primary)}
                  aria-expanded={moreMenu}
                  aria-controls="account-other-sections"
                  aria-label={
                    current && !current.primary
                      ? t("Više odjeljaka naloga, odabrano: {section}", {
                          section: t(current.label),
                        })
                      : t("Više odjeljaka naloga")
                  }
                  onClick={() => setMoreMenu(!moreMenu)}
                >
                  <Icon name="menu" />
                  <span>{t("Više")}</span>
                </button>
                <div
                  id="account-other-sections"
                  className={styles.otherSections}
                  data-expanded={moreMenu}
                >
                  {([msg("Lični nalog"), msg("Poslovanje")] as const)
                    // A group without items would show a bare heading above whatever follows it.
                    .filter((group) => menu.some((item) => item.group === group))
                    .map((group) => (
                      <section className={styles.menuGroup} aria-label={t(group)} key={group}>
                        <span className={styles.groupLabel} aria-hidden="true">
                          {t(group)}
                        </span>
                        {menu.filter((item) => item.group === group).map(tab)}
                      </section>
                    ))}
                  {profile.role === "owner" && (
                    <section className={styles.menuGroup} aria-label={t("Administracija")}>
                      <span className={styles.groupLabel} aria-hidden="true">
                        {t("Administracija")}
                      </span>
                      <Link href="/administracija" className={styles.adminLink}>
                        <Icon name="shield" />
                        {t("Upravljanje platformom")}
                      </Link>
                    </section>
                  )}
                </div>
              </nav>
            </div>
            <button
              className={styles.logout}
              type="button"
              aria-label={t("Odjava")}
              title={t("Odjava")}
              disabled={busy}
              onClick={logout}
            >
              <Icon name="logout" />
              <span>{t("Odjava")}</span>
            </button>
          </aside>
          <section
            id="account-panel"
            className={styles.content}
            data-section={section}
            data-design="account-panel"
          >
            {/* On a phone every part of the account is a screen of its own with a way back to
                "Moj profil"; the old card with tabs is gone (see account.module.css). */}
            {current &&
              !["overview", "settings", "messages", "businesses", "saved"].includes(section) && (
                <div className={styles.phoneBar}>
                  <ScreenBar
                    title={section === "profile" ? t("Uredi profil") : t(current.label)}
                    backHref="/nalog"
                    backLabel={t("Moj profil")}
                  />
                </div>
              )}
            {IS_PLAY_EDITION &&
              hasAccess &&
              ["profile", "businesses", "messages"].includes(section) && (
                <CommunityRulesPrompt key={initial.id} actor={initial.id} />
              )}
            {error && (
              <p role="alert" className={styles.feedback}>
                {error}
              </p>
            )}
            <AccountPane selected={section === "overview"}>
              <AccountOverview
                accountId={initial.id}
                name={profile.name}
                administrator={profile.role === "owner"}
                profile={personal}
                active={hasAccess && section === "overview"}
                onSection={changeSection}
                onAddBusiness={addBusiness}
                onProfile={setPersonal}
              />
            </AccountPane>
            <AccountPane selected={section === "profile"}>
              <PersonalProfileWorkspace
                active={hasAccess && section === "profile"}
                expectedAccountId={initial.id}
                onAccessDenied={() => setPersonal(null)}
                onProfileChanged={(next) => {
                  setPersonal(next);
                  setProfile((current) => ({ ...current, name: next.name }));
                }}
                onBusinesses={() => changeSection("businesses")}
                editOnly
                onDone={() => changeSection("overview")}
              />
            </AccountPane>
            <AccountPane selected={section === "businesses"}>
              <div hidden={Boolean(view.calendarTarget)}>
                <BusinessManager
                  active={hasAccess && section === "businesses" && !view.calendarTarget}
                  startCreation={startBusinessCreation}
                  isOwner={profile.role === "owner"}
                  expectedAccountId={initial.id}
                />
              </div>
              {hasAccess && section === "businesses" && view.calendarTarget && (
                <OwnerCalendarPanel
                  key={`${view.calendarTarget.businessId}:${view.calendarTarget.kind}:${view.calendarTarget.day ?? ""}`}
                  target={view.calendarTarget}
                  accountId={initial.id}
                  onBack={() => changeSection("businesses")}
                />
              )}
            </AccountPane>
            <AccountPane selected={section === "appointments"}>
              <CustomerAppointments
                active={hasAccess && section === "appointments"}
                initialView={
                  searchParams?.get("prikaz") === "historija" &&
                  searchParams.getAll("prikaz").length === 1
                    ? "history"
                    : "upcoming"
                }
                expectedAccountId={initial.id}
              />
            </AccountPane>
            <AccountPane selected={section === "saved"}>
              <nav aria-label={t("Sačuvano")} className={styles.savedLinks} hidden={!hasAccess}>
                <Link className="text-link" href="/sacuvane-pretrage">
                  {t("Sačuvane pretrage")}
                </Link>
                <Link className="text-link" href="/blog?sacuvano=1">
                  {t("Sačuvani članci")}
                </Link>
              </nav>
              <SavedBusinesses
                active={hasAccess && section === "saved"}
                expectedAccountId={initial.id}
              />
            </AccountPane>
            <AccountPane selected={section === "connections"}>
              <ConnectionsPanel
                active={hasAccess && section === "connections"}
                expectedAccountId={initial.id}
              />
            </AccountPane>
            <AccountPane selected={section === "messages"}>
              {view.invalidMessageTarget && (
                <p role="alert" className={styles.feedback}>
                  {t("Link za razgovor nije ispravan.")}
                </p>
              )}
              <MessagingInbox
                active={hasAccess && section === "messages"}
                initialTarget={view.messageTarget}
                initialBusinessThread={view.businessThread}
                expectedAccountId={initial.id}
              />
            </AccountPane>
            <AccountPane selected={section === "settings"}>
              <AccountSettings
                key={initial.id}
                initial={initial}
                active={hasAccess && section === "settings"}
                focusNotifications={focusNotifications}
                verified={personal ? personal.verified : null}
                onConfirmed={(next) =>
                  setProfile((current) => ({
                    ...current,
                    locale: next.locale,
                    appearance: next.appearance,
                  }))
                }
              />
            </AccountPane>
          </section>
        </main>
      )}
    </AccountAuthorityBoundary>
  );
}
