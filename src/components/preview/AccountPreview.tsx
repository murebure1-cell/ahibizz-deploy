"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountSettingsError } from "../../lib/account-settings";
import { isAppearance } from "../../lib/appearance";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { AccountSettings } from "../account/AccountSettings";
import { CustomerAppointments } from "../booking/CustomerAppointments";
import { ConnectionsPanel } from "../connections/ConnectionsPanel";
import { Icon, type IconName } from "../Icon";
import { PersonalProfileWorkspace } from "../people/PersonalProfileWorkspace";
import styles from "./account.module.css";
import { useBookingPreview } from "./BookingPreviewState";
import { BusinessCard } from "./BusinessCard";
import { BusinessPreview } from "./BusinessPreview";
import { useConnectionsPreview } from "./ConnectionsPreviewState";
import { previewBusinesses } from "./data";
import { MessagingPreview } from "./MessagingPreview";
import { usePeoplePreview } from "./PeoplePreviewState";
import { usePreviewState } from "./PreviewState";

const sections = [
  { id: "overview", label: "Pregled", icon: "home" },
  { id: "appointments", label: "Moji termini", icon: "calendar" },
  { id: "saved", label: "Sačuvani", icon: "heart" },
  { id: "businesses", label: "Moje djelatnosti", icon: "shop" },
  { id: "messages", label: "Poruke", icon: "message" },
  { id: "profile", label: "Moj profil", icon: "user" },
  { id: "connections", label: "Prijatelji", icon: "user" },
  { id: "settings", label: "Postavke", icon: "sliders" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

type Section = (typeof sections)[number]["id"];

function EmptyState({
  icon,
  title,
  children,
  browse = false,
}: {
  icon: IconName;
  title: string;
  children: string;
  browse?: boolean;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {browse && (
        <Link className={styles.primary} href="/pregled/pretraga">
          Istraži djelatnosti <Icon name="arrow" />
        </Link>
      )}
    </div>
  );
}

export function AccountPreview() {
  const preview = usePreviewState();
  const booking = useBookingPreview();
  const person = usePeoplePreview();
  const connections = useConnectionsPreview();
  const selectedSection = useSearchParams().get("odjeljak");
  const [section, setSection] = useState<Section>("overview");
  const navigation = useRef<HTMLElement>(null);
  const name = person.getProfile().name;
  const settings = useRef<SafeAccountProfile>({
    id: person.getProfile().id,
    name,
    email: "preview@example.invalid",
    role: "member",
    approval: "approved",
    emailVerified: true,
    locale: "bs",
    appearance: "system",
  });
  const settingsRequest = useRef(async (options: RequestInit = {}) => {
    if (options.method === "PATCH") {
      const value = JSON.parse(String(options.body)) as Record<string, unknown>;
      if (
        !isAppearance(value.appearance) ||
        value.expectedAppearance !== settings.current.appearance
      )
        throw new AccountSettingsError(409, "APPEARANCE_CONFLICT");
      settings.current = { ...settings.current, appearance: value.appearance };
    }
    return { account: { ...settings.current } };
  });
  const saved = previewBusinesses.filter((business) => preview.saved.has(business.id));
  const current = sections.find((item) => item.id === section) ?? sections[0];

  useEffect(() => {
    if (selectedSection === "termini") setSection("appointments");
    if (selectedSection === "profil") setSection("profile");
    if (selectedSection === "prijatelji") setSection("connections");
    if (selectedSection === "djelatnosti") setSection("businesses");
    if (selectedSection === "poruke") setSection("messages");
    if (selectedSection === "postavke") setSection("settings");
  }, [selectedSection]);
  // Keep the active account section visible in the horizontal mobile navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Section changes update the rendered aria-current target.
  useEffect(() => {
    const nav = navigation.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && selected && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft += selected.getBoundingClientRect().left - nav.getBoundingClientRect().left;
  }, [section]);

  return (
    <main id="glavni-sadrzaj" className={`preview-container ${styles.page}`}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>TVOJ AHIBIZZ</p>
          <h1>Moj nalog</h1>
          <p className={styles.intro}>Termini, sačuvano i postavke.</p>
        </div>
        <span className={styles.previewLabel}>Ogledni prikaz</span>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {person.imageUrl("photo") ? (
                <Image
                  src={person.imageUrl("photo") as string}
                  alt=""
                  width={50}
                  height={50}
                  unoptimized
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: "inherit",
                  }}
                />
              ) : (
                name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => Array.from(word)[0] ?? "")
                  .join("")
                  .toLocaleUpperCase("bs")
              )}
            </span>
            <div>
              <strong>{name}</strong>
              <span>Lokalni pregled naloga</span>
            </div>
          </div>
          <nav ref={navigation} className={styles.navigation} aria-label="Odjeljci naloga">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={section === item.id ? "page" : undefined}
                aria-controls="account-preview-panel"
                onClick={() => setSection(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                <Icon name="chevron" className={styles.navArrow} />
              </button>
            ))}
          </nav>
          <p className={styles.sidebarNote}>Bez prijave i stvarnih podataka.</p>
        </aside>

        <section
          id="account-preview-panel"
          className={styles.panel}
          data-section={section}
          aria-labelledby="account-preview-title"
        >
          <div className={styles.panelHeading}>
            <h2 id="account-preview-title">{current.label}</h2>
            {section === "overview" && (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => setSection("profile")}
              >
                Uredi profil <Icon name="arrow" />
              </button>
            )}
          </div>

          {section === "overview" && (
            <>
              <div className={styles.nextAppointment}>
                <span className={styles.nextIcon}>
                  <Icon name="calendar" />
                </span>
                <div>
                  <span className={styles.smallLabel}>SLJEDEĆI TERMIN</span>
                  <h3>Tvoji termini, na jednom mjestu.</h3>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => setSection("appointments")}
                  >
                    Otvori kalendar termina
                  </button>
                </div>
              </div>
              <div className={styles.shortcuts}>
                {(
                  [
                    {
                      id: "saved",
                      icon: "heart",
                      title: "Sačuvani profili",
                      text: saved.length
                        ? "Tvoj izbor, na jednom mjestu."
                        : "Pronađi profil i sačuvaj ga za kasnije.",
                    },
                    {
                      id: "businesses",
                      icon: "shop",
                      title: "Moje djelatnosti",
                      text: "Isprobaj dodavanje i uređivanje djelatnosti.",
                    },
                    {
                      id: "settings",
                      icon: "sliders",
                      title: "Postavke prikaza",
                      text: "Pogledaj izbor jezika i teme.",
                    },
                  ] as const
                ).map((item) => (
                  <button key={item.id} type="button" onClick={() => setSection(item.id)}>
                    <span className={styles.shortcutIcon}>
                      <Icon name={item.icon} />
                    </span>
                    <span>
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </span>
                    <Icon name="chevron" />
                  </button>
                ))}
              </div>
            </>
          )}

          <div hidden={section !== "appointments"}>
            <CustomerAppointments
              heading={false}
              expectedAccountId="00100000-0000-4000-8000-000000000002"
              active={section === "appointments"}
              preview
              request={booking.customerRequest}
            />
          </div>

          {section === "saved" &&
            (saved.length ? (
              <>
                <p className={styles.sectionNote}>Primjeri koje si sačuvao tokom pregleda.</p>
                <div className={styles.savedGrid}>
                  {saved.map((business) => (
                    <BusinessCard key={business.id} business={business} />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon="heart" title="Sačuvaj ono što ti se sviđa." browse>
                Dotakni srce na profilu djelatnosti i pronađi ga ovdje.
              </EmptyState>
            ))}

          <div hidden={section !== "businesses"}>
            <BusinessPreview />
          </div>
          <div hidden={section !== "messages"}>
            <MessagingPreview active={section === "messages"} embedded />
          </div>

          <div hidden={section !== "profile"}>
            <PersonalProfileWorkspace
              active={section === "profile"}
              expectedAccountId={person.getProfile().id}
              preview
              request={person.request}
              connectionsRequest={connections.request}
              publicHref={(id) => `/pregled/ljudi?profil=${encodeURIComponent(id)}`}
              photoUrl={person.imageUrl("photo")}
              coverUrl={person.imageUrl("cover")}
              onBusinesses={() => setSection("businesses")}
            />
          </div>
          <div hidden={section !== "connections"}>
            <ConnectionsPanel
              expectedAccountId={person.getProfile().id}
              active={section === "connections"}
              heading={false}
              preview
              request={connections.request}
              profileHref={(id) => `/pregled/ljudi?profil=${encodeURIComponent(id)}`}
              peopleHref="/pregled/ljudi"
              imageUrl={connections.imageUrl}
            />
          </div>
          <div hidden={section !== "settings"}>
            <AccountSettings
              initial={settings.current}
              active={section === "settings"}
              request={settingsRequest.current}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
