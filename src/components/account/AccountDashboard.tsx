"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AccountSection } from "../../lib/account-return";
import type { MessageTarget } from "../../lib/messaging";
import { type PersonalProfile, profileImageUrl } from "../../lib/people";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { CustomerAppointments } from "../booking/CustomerAppointments";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
import { BusinessManager } from "../directory/BusinessManager";
import { Icon } from "../Icon";
import { MessagingInbox } from "../messaging/MessagingInbox";
import { PersonalProfileWorkspace } from "../people/PersonalProfileWorkspace";
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
    [section, setSection] = useState<AccountSection>(initialSection),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const photo = personal ? profileImageUrl(personal, "photo") : null;
  const targetKey = messageTarget ? `${messageTarget.kind}:${messageTarget.targetId}` : "";
  useEffect(() => {
    setSection(targetKey ? "messages" : initialSection);
  }, [initialSection, targetKey]);
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
                width={62}
                height={62}
                unoptimized
                style={{ borderRadius: "50%", objectFit: "cover", width: "100%", height: "100%" }}
              />
            ) : (
              profile.name.slice(0, 1).toLocaleUpperCase("bs")
            )}
          </span>
          <strong>{profile.name}</strong>
          <small>{profile.role === "owner" ? "Administrator" : "Moj AhiBizz"}</small>
        </div>
        <nav aria-label="Moj nalog">
          {(
            [
              { id: "profile", label: "Moj profil", icon: "user" },
              { id: "businesses", label: "Djelatnosti", icon: "shop" },
              { id: "messages", label: "Poruke", icon: "message" },
              { id: "appointments", label: "Moji termini", icon: "calendar" },
              { id: "connections", label: "Prijatelji", icon: "user" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => {
                setSection(item.id);
                setError("");
              }}
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
      <section className={styles.content}>
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
            onBusinesses={() => setSection("businesses")}
          />
        </div>
        <div hidden={section !== "businesses"}>
          <BusinessManager active={section === "businesses"} isOwner={profile.role === "owner"} />
        </div>
        <div hidden={section !== "appointments"}>
          <CustomerAppointments active={section === "appointments"} />
        </div>
        <div hidden={section !== "connections"}>
          <ConnectionsPanel active={section === "connections"} />
        </div>
        <div hidden={section !== "messages"}>
          {invalidMessageTarget && (
            <p role="alert" className={styles.feedback}>
              Link za razgovor nije ispravan.
            </p>
          )}
          <MessagingInbox active={section === "messages"} initialTarget={messageTarget} />
        </div>
      </section>
    </main>
  );
}
