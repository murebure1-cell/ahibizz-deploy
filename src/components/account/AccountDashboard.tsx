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
import { campaignPath } from "../../lib/ad-brief";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import { placementOfferPath } from "../../lib/marketing";
import type { MessageTarget } from "../../lib/messaging";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { type PersonalProfile, profileImageUrl } from "../../lib/people";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useAppAppearance } from "../appearance/AppAppearance";
import { PricingCatalog } from "../billing/PricingCatalog";
import { SavedBusinesses } from "../favorites/SavedBusinesses";
import { Icon, type IconName } from "../Icon";
import { PersonalProfileWorkspace } from "../people/PersonalProfileWorkspace";
import { CommunityRulesPrompt } from "../support/CommunityRulesPrompt";
import { AccountAuthorityBoundary } from "./AccountAuthorityBoundary";
import { AccountOverview, CurrentPlacements, MembershipOverview } from "./AccountOverview";
import { AccountSettings } from "./AccountSettings";
import styles from "./account.module.css";

function paneHeading(label: string) {
  return (
    <h2 className={styles.paneHeading} aria-busy="true">
      {label}
    </h2>
  );
}
const OwnerCalendarPanel = dynamic(() =>
  import("./OwnerCalendarPanel").then((m) => m.OwnerCalendarPanel),
);
const BusinessManager = dynamic(
  () => import("../directory/BusinessManager").then((m) => m.BusinessManager),
  { loading: () => paneHeading("Djelatnosti") },
);
const MessagingInbox = dynamic(
  () => import("../messaging/MessagingInbox").then((m) => m.MessagingInbox),
  { loading: () => paneHeading("Poruke") },
);
const CustomerAppointments = dynamic(
  () => import("../booking/CustomerAppointments").then((m) => m.CustomerAppointments),
  { loading: () => paneHeading("Moji termini") },
);
const ConnectionsPanel = dynamic(
  () => import("../connections/ConnectionsPanel").then((m) => m.ConnectionsPanel),
  { loading: () => paneHeading("Prijatelji") },
);
const MarketingWorkspace = dynamic(() =>
  import("../marketing/MarketingWorkspace").then((m) => m.MarketingWorkspace),
);
const accountMenu = [
  { id: "overview", label: "Pregled", icon: "home", primary: true },
  { id: "businesses", label: "Djelatnosti", icon: "shop", primary: true },
  { id: "messages", label: "Poruke", icon: "message", primary: true },
  { id: "profile", label: "Moj profil", icon: "user", group: "Lični nalog" },
  { id: "appointments", label: "Moji termini", icon: "calendar", group: "Lični nalog" },
  { id: "connections", label: "Prijatelji", icon: "people", group: "Lični nalog" },
  { id: "saved", label: "Sačuvane djelatnosti", icon: "heart", group: "Lični nalog" },
  { id: "settings", label: "Postavke", icon: "sliders", group: "Lični nalog" },
  { id: "advertising", label: "Moji oglasi", icon: "star", group: "Poslovanje" },
  { id: "membership", label: "Pretplate", icon: "crown", group: "Poslovanje" },
  { id: "credits", label: "Ahi Credits", icon: "card", digital: true, group: "Poslovanje" },
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
  const section = IS_PLAY_EDITION && view.section === "credits" ? "overview" : view.section;
  const focusNotifications =
    section === "settings" &&
    searchParams?.getAll("prikaz").length === 1 &&
    searchParams.get("prikaz") === "obavijesti";
  const startBusinessCreation =
    section === "businesses" &&
    searchParams?.getAll("novo").length === 1 &&
    searchParams.get("novo") === "1";
  const returnPath = view.campaign
    ? campaignPath(view.campaign)
    : view.placementTarget
      ? placementOfferPath(view.placementTarget)
      : focusNotifications
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
        <span>{item.label}</span>
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
        setError("Odjava nije uspjela. Pokušaj ponovo.");
        return;
      }
      clearBrowserMessagingRecovery(initial.id);
      resetAppearance();
      window.location.assign("/prijava");
    } catch {
      setError("Odjava nije uspjela. Pokušaj ponovo.");
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
                <strong>{profile.name}</strong>
                <small>{profile.role === "owner" ? "Administrator" : "Moj AhiBizz"}</small>
              </div>
            </div>
            <div className={styles.navigationViewport}>
              <nav aria-label="Moj nalog">
                {menu.filter((item) => item.primary).map(tab)}
                <button
                  ref={moreControl}
                  type="button"
                  className={styles.moreControl}
                  data-current={Boolean(current && !current.primary)}
                  aria-expanded={moreMenu}
                  aria-controls="account-other-sections"
                  aria-label={`Više odjeljaka naloga${current && !current.primary ? `, odabrano: ${current.label}` : ""}`}
                  onClick={() => setMoreMenu(!moreMenu)}
                >
                  <Icon name="menu" />
                  <span>Više</span>
                </button>
                <div
                  id="account-other-sections"
                  className={styles.otherSections}
                  data-expanded={moreMenu}
                >
                  {(["Lični nalog", "Poslovanje"] as const).map((group) => (
                    <section className={styles.menuGroup} aria-label={group} key={group}>
                      <span className={styles.groupLabel} aria-hidden="true">
                        {group}
                      </span>
                      {menu.filter((item) => item.group === group).map(tab)}
                    </section>
                  ))}
                  {profile.role === "owner" && (
                    <Link href="/administracija" className={styles.adminLink}>
                      <Icon name="shield" />
                      Administracija
                    </Link>
                  )}
                </div>
              </nav>
            </div>
            <button
              className={styles.logout}
              type="button"
              aria-label="Odjava"
              title="Odjava"
              disabled={busy}
              onClick={logout}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4" />
              </svg>
              <span>Odjava</span>
            </button>
          </aside>
          <section
            id="account-panel"
            className={styles.content}
            data-section={section}
            data-design="account-panel"
          >
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
                active={hasAccess && section === "overview"}
                onSection={changeSection}
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
              <nav aria-label="Sačuvano" className={styles.savedLinks} hidden={!hasAccess}>
                <Link className="text-link" href="/sacuvane-pretrage">
                  Sačuvane pretrage
                </Link>
                <Link className="text-link" href="/blog?sacuvano=1">
                  Sačuvani članci
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
                  Link za razgovor nije ispravan.
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
                onConfirmed={(next) =>
                  setProfile((current) => ({
                    ...current,
                    locale: next.locale,
                    appearance: next.appearance,
                  }))
                }
              />
            </AccountPane>
            {!IS_PLAY_EDITION &&
              hasAccess &&
              (section === "credits" || section === "advertising") && (
                <MarketingWorkspace
                  key={section}
                  accountId={initial.id}
                  mode={section === "credits" ? "credits" : "ads"}
                  target={view.placementTarget}
                  campaign={view.campaign}
                  promotionView={
                    searchParams?.getAll("prikaz").length === 1
                      ? searchParams.get("prikaz") === "aktivne"
                        ? "aktivne"
                        : searchParams.get("prikaz") === "zakazane"
                          ? "zakazane"
                          : undefined
                      : undefined
                  }
                />
              )}
            {IS_PLAY_EDITION && section === "advertising" && (
              <CurrentPlacements accountId={initial.id} active={hasAccess} />
            )}
            {section === "membership" && (
              <>
                <MembershipOverview accountId={initial.id} active={hasAccess} />
                {!IS_PLAY_EDITION && <PricingCatalog embedded />}
              </>
            )}
          </section>
        </main>
      )}
    </AccountAuthorityBoundary>
  );
}
