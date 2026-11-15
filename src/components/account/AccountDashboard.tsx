"use client";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AccountSection,
  accountSectionPath,
  readAccountNavigation,
} from "../../lib/account-return";
import type { MessageTarget } from "../../lib/messaging";
import { clearBrowserMessagingRecovery } from "../../lib/messaging-recovery-storage";
import { type PersonalProfile, profileImageUrl } from "../../lib/people";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useAppAppearance } from "../appearance/AppAppearance";
import { CustomerAppointments } from "../booking/CustomerAppointments";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
import { BusinessManager } from "../directory/BusinessManager";
import { Icon } from "../Icon";
import { MessagingInbox } from "../messaging/MessagingInbox";
import { PersonalProfileWorkspace } from "../people/PersonalProfileWorkspace";
import { AccountSettings } from "./AccountSettings";
import styles from "./account.module.css";
export function AccountDashboard({
  initial,
  initialSection = "profile",
  messageTarget,
  invalidMessageTarget = false,
}: {
  initial: SafeAccountProfile;
  initialSection?: AccountSection;
  messageTarget?: MessageTarget;
  invalidMessageTarget?: boolean;
}) {
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
  const navigation = useRef<HTMLElement>(null);
  const view = useMemo(
    () =>
      query === undefined
        ? { section: initialSection, messageTarget, invalidMessageTarget }
        : readAccountNavigation(new URLSearchParams(query)),
    [query, initialSection, messageTarget, invalidMessageTarget],
  );
  const section = view.section;
  const photo = personal ? profileImageUrl(personal, "photo") : null;
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const reveal = () => {
      const selected = nav.querySelector<HTMLElement>(`[data-account-section="${section}"]`);
      if (!selected || nav.scrollWidth <= nav.clientWidth) return;
      const left = selected.getBoundingClientRect().left - nav.getBoundingClientRect().left;
      const right = left + selected.offsetWidth;
      if (left < 0) nav.scrollLeft += left;
      else if (right > nav.clientWidth) nav.scrollLeft += right - nav.clientWidth;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [section]);
  function changeSection(next: AccountSection) {
    const href = accountSectionPath(next);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href)
      window.history.pushState(null, "", href);
    setError("");
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
    <main id="glavni-sadrzaj" className={styles.layout}>
      <aside className={styles.sidebar}>
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
        <nav ref={navigation} aria-label="Moj nalog">
          {(
            [
              { id: "profile", label: "Moj profil", icon: "user" },
              { id: "businesses", label: "Djelatnosti", icon: "shop" },
              { id: "messages", label: "Poruke", icon: "message" },
              { id: "appointments", label: "Moji termini", icon: "calendar" },
              { id: "connections", label: "Prijatelji", icon: "user" },
              { id: "settings", label: "Postavke", icon: "sliders" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              data-account-section={item.id}
              aria-current={section === item.id ? "page" : undefined}
              aria-controls="account-panel"
              onClick={() => changeSection(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
          {profile.role === "owner" && (
            <Link href="/administracija" className={styles.adminLink}>
              <Icon name="sliders" />
              Administracija
            </Link>
          )}
        </nav>
        <button className={styles.logout} type="button" disabled={busy} onClick={logout}>
          Odjava
        </button>
      </aside>
      <section id="account-panel" className={styles.content} data-section={section}>
        {error && (
          <p role="alert" className={styles.feedback}>
            {error}
          </p>
        )}
        <div hidden={section !== "profile"}>
          <PersonalProfileWorkspace
            active={section === "profile"}
            onProfileChanged={(next) => {
              setPersonal(next);
              setProfile((current) => ({ ...current, name: next.name }));
            }}
            onBusinesses={() => changeSection("businesses")}
          />
        </div>
        <div hidden={section !== "businesses"}>
          <BusinessManager active={section === "businesses"} isOwner={profile.role === "owner"} />
        </div>
        <div hidden={section !== "appointments"}>
          <CustomerAppointments active={section === "appointments"} />
        </div>
        <div hidden={section !== "connections"}>
          <ConnectionsPanel active={section === "connections"} expectedAccountId={initial.id} />
        </div>
        <div hidden={section !== "messages"}>
          {view.invalidMessageTarget && (
            <p role="alert" className={styles.feedback}>
              Link za razgovor nije ispravan.
            </p>
          )}
          <MessagingInbox
            active={section === "messages"}
            initialTarget={view.messageTarget}
            expectedAccountId={initial.id}
          />
        </div>
        <div hidden={section !== "settings"}>
          <AccountSettings
            key={initial.id}
            initial={initial}
            active={section === "settings"}
            onConfirmed={(next) =>
              setProfile((current) => ({
                ...current,
                locale: next.locale,
                appearance: next.appearance,
              }))
            }
          />
        </div>
      </section>
    </main>
  );
}
