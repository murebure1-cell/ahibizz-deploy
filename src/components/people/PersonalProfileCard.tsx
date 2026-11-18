"use client";

import Image from "next/image";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import {
  type PersonalProfile,
  profileCountries,
  profileImageUrl,
  workStatusLabels,
} from "../../lib/people";
import { Icon } from "../Icon";
import { VerificationBadge } from "../VerificationBadge";
import { PlatformBadges } from "./PlatformBadges";
import styles from "./profile.module.css";

export function profileInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toLocaleUpperCase("bs-BA");
}

/** Only application-provided local media paths and same-origin object URLs are displayed. */
export function personalProfileImage(value: string | null): string | null {
  if (
    !value ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("blob:") && typeof window !== "undefined") {
    try {
      return new URL(value).origin === window.location.origin ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function PersonalProfileCard({
  profile,
  onEdit,
  onBusinesses,
  onConnections,
  photoUrl,
  coverUrl,
}: {
  profile: PersonalProfile;
  onEdit?: () => void;
  onBusinesses?: () => void;
  onConnections?: () => void;
  photoUrl?: string | null;
  coverUrl?: string | null;
}) {
  const [tab, setTab] = useState("about");
  const tabId = useId(),
    tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [
    ["about", "O meni"],
    ["skills", "Vještine"],
    ["photos", "Fotografije"],
  ] as const;
  const photo = personalProfileImage(
    photoUrl === undefined ? profileImageUrl(profile, "photo") : photoUrl,
  );
  const cover = profile.canCustomizeCover
    ? personalProfileImage(coverUrl === undefined ? profileImageUrl(profile, "cover") : coverUrl)
    : null;
  const country =
    profileCountries.find(([code]) => code === profile.countryCode)?.[1] ?? profile.countryCode;
  const location = [profile.city, country].filter(Boolean).join(", ");
  const hasDetails = Boolean(profile.city || country || profile.workStatus !== "not_specified");

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[next];
    if (!nextTab) return;
    setTab(nextTab[0]);
    tabButtons.current[next]?.focus();
  }
  return (
    <article className={styles.profile} aria-label="Lični profil">
      <div className={`${styles.cover} ${!cover ? styles.defaultCover : ""}`}>
        {cover ? (
          <Image
            className={styles.coverImage}
            src={cover}
            alt="Naslovna fotografija profila"
            width={1600}
            height={600}
            unoptimized
          />
        ) : (
          <Image
            className={styles.coverBrand}
            src="/brand/ahi-logo-white.svg"
            alt="AhiBizz"
            width={160}
            height={43}
            unoptimized
          />
        )}
      </div>
      <div className={styles.identity}>
        <div className={styles.avatar}>
          {photo ? (
            <Image
              className={styles.avatarImage}
              src={photo}
              alt={`Profilna fotografija: ${profile.name}`}
              width={320}
              height={320}
              unoptimized
            />
          ) : (
            <span className={styles.initials} aria-hidden="true">
              {profileInitials(profile.name)}
            </span>
          )}
        </div>
        <div className={styles.heading}>
          <h2>
            {profile.name}
            {profile.verified && <VerificationBadge kind="person" />}
          </h2>
          <PlatformBadges
            platformFounder={profile.platformFounder}
            platformAdministrator={profile.platformAdministrator}
          />
          {profile.bio && <p className={styles.intro}>{profile.bio}</p>}
          {location && (
            <p className={styles.location}>
              <Icon name="pin" />
              {location}
            </p>
          )}
          {profile.workStatus !== "not_specified" && (
            <p className={styles.work}>
              <span aria-hidden="true" />
              {workStatusLabels[profile.workStatus]}
            </p>
          )}
        </div>
        {(onEdit || onBusinesses || onConnections) && (
          <div className={styles.actions}>
            {onEdit && (
              <button className={styles.primary} type="button" onClick={onEdit}>
                <Icon name="sliders" />
                Uredi profil
              </button>
            )}
            {onBusinesses && (
              <button className={styles.secondary} type="button" onClick={onBusinesses}>
                <Icon name="shop" />
                Moje djelatnosti
              </button>
            )}
            {onConnections && (
              <button className={styles.secondary} type="button" onClick={onConnections}>
                <Icon name="user" />
                Prijatelji
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Sadržaj profila">
        {tabs.map(([value, label], index) => (
          <button
            key={value}
            ref={(element) => {
              tabButtons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${tabId}-${value}-tab`}
            aria-controls={`${tabId}-${value}-panel`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onKeyDown={(event) => tabKey(event, index)}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        <section
          className={styles.section}
          role="tabpanel"
          id={`${tabId}-about-panel`}
          aria-labelledby={`${tabId}-about-tab`}
          hidden={tab !== "about"}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs use focusable static panels.
          tabIndex={0}
        >
          <h3>Osnovni podaci</h3>
          {hasDetails ? (
            <dl className={styles.details}>
              {profile.city && (
                <div>
                  <dt>Grad</dt>
                  <dd>{profile.city}</dd>
                </div>
              )}
              {country && (
                <div>
                  <dt>Država</dt>
                  <dd>{country}</dd>
                </div>
              )}
              {profile.workStatus !== "not_specified" && (
                <div>
                  <dt>Poslovni status</dt>
                  <dd>{workStatusLabels[profile.workStatus]}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className={styles.empty}>Još nema dodatnih podataka.</p>
          )}
        </section>
        <section
          className={styles.section}
          role="tabpanel"
          id={`${tabId}-skills-panel`}
          aria-labelledby={`${tabId}-skills-tab`}
          hidden={tab !== "skills"}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs use focusable static panels.
          tabIndex={0}
        >
          <h3>Vještine</h3>
          {profile.skills.length > 0 ? (
            <ul className={styles.chips}>
              {profile.skills.map((skill) => (
                <li className={styles.chip} key={skill}>
                  {skill}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Još nema dodanih vještina.</p>
          )}
        </section>
        <section
          className={styles.section}
          role="tabpanel"
          id={`${tabId}-photos-panel`}
          aria-labelledby={`${tabId}-photos-tab`}
          hidden={tab !== "photos"}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs use focusable static panels.
          tabIndex={0}
        >
          <h3>Fotografije</h3>
          {photo || cover ? (
            <div className={styles.photos}>
              {photo && (
                <figure className={styles.photoItem}>
                  <Image
                    src={photo}
                    alt={`Profilna fotografija: ${profile.name}`}
                    width={512}
                    height={512}
                    unoptimized
                  />
                  <figcaption>Profilna fotografija</figcaption>
                </figure>
              )}
              {cover && (
                <figure className={styles.photoItem} data-kind="cover">
                  <Image
                    src={cover}
                    alt="Naslovna fotografija profila"
                    width={1600}
                    height={600}
                    unoptimized
                  />
                  <figcaption>Naslovna fotografija</figcaption>
                </figure>
              )}
            </div>
          ) : (
            <p className={styles.empty}>Još nema dodanih fotografija.</p>
          )}
        </section>
      </div>
    </article>
  );
}
