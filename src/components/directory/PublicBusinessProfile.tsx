"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { messageLink } from "../../lib/messaging";
import {
  businessContactLinks,
  businessDirections,
  businessLocationLabel,
  displayPhone,
  type PublicBusinessView,
  publicBusinessPoint,
  safeBusinessImage,
} from "../../lib/public-business";
import { reportUrl } from "../../lib/support-requests";
import { AhiMark } from "../AhiMark";
import { FavoriteButton } from "../favorites/FavoriteButton";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import { BusinessReviews } from "../reviews/BusinessReviews";
import { VerificationBadge } from "../VerificationBadge";
import { sendTouch } from "../ViewBeacon";
import { BusinessAmenities, BusinessHoursSheet } from "./BusinessDetails";
import { BusinessGallery } from "./BusinessGallery";
import { BusinessLogo } from "./BusinessLogo";
import { BusinessRating } from "./BusinessRating";
import { PublicProfileMap } from "./PublicProfileMap";
import styles from "./public-profile.module.css";
import { ShareButton } from "./ShareButton";

export function PublicBusinessProfile({
  business,
  backHref = "/pretraga",
  preview = false,
  children,
  actions,
  messageHref,
  offerLinks: _offerLinks,
  offerSections,
  sponsor,
}: {
  business: PublicBusinessView;
  backHref?: string | null;
  preview?: boolean;
  children?: ReactNode;
  actions?: ReactNode;
  messageHref?: string;
  offerLinks?: ReactNode;
  offerSections?: ReactNode;
  sponsor?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const links = businessContactLinks(business);
  const point = publicBusinessPoint(business);
  const driving = businessDirections(business, "driving");
  const walking = businessDirections(business, "walking");
  const hasAddress = Boolean(
    business.addressLine?.trim() ||
      business.city?.trim() ||
      /^[a-z]{2}$/i.test(business.countryCode ?? ""),
  );
  const location = hasAddress
    ? businessLocationLabel(business, locale)
    : point
      ? t("Lokacija je označena na karti.")
      : businessLocationLabel(business, locale);
  // As drawn: the main category, then the street and the city ("Ugostiteljstvo · Ferhadija 12,
  // Sarajevo"); the full address with the country stays in the location section.
  const taxonomy = business.categoryName ? t(business.categoryName) : "";
  const shortLocation =
    [business.addressLine?.trim(), business.city?.trim()].filter(Boolean).join(", ") || location;
  const photo = safeBusinessImage(business.image, preview);
  const logo = safeBusinessImage(business.logo, preview);
  const cover = photo && photo.src !== logo?.src ? photo : undefined;
  const gallery = (business.gallery ?? []).slice(0, 8).flatMap((image) => {
    const safe = safeBusinessImage(image, preview);
    return safe ? [safe] : [];
  });
  const hasAppointments = Boolean(children);
  const hasAbout = Boolean(business.description?.trim() || business.details?.amenities.length);
  const hasLocation = hasAddress || Boolean(point);
  const contactMessage =
    messageHref ?? (!preview ? messageLink({ kind: "business", targetId: business.id }) : null);
  const hasContact = Boolean(links.phone || links.email || links.website || contactMessage);
  const Title = backHref === null ? "h2" : "h1";

  return (
    <article
      aria-label={t("Poslovni profil")}
      className={styles.profile}
      data-design="business-profile"
      data-preview={preview || undefined}
      data-embedded={backHref === null || undefined}
    >
      <div className={styles.cover} data-design="business-cover" data-photo={Boolean(cover)}>
        {cover ? (
          <Image
            src={cover.src}
            data-design="business-photo"
            alt={t(cover.alt)}
            fill
            sizes="(max-width: 700px) 100vw, 1160px"
            loading="eager"
            fetchPriority="high"
            unoptimized
          />
        ) : (
          <AhiMark size={57} className={styles.brandMark} />
        )}
        <div className={styles.coverBar}>
          {backHref !== null && (
            <Link
              className={styles.coverControl}
              href={backHref}
              aria-label={
                backHref.startsWith("/pretraga?") ? t("Nazad na rezultate") : t("Sve djelatnosti")
              }
            >
              <Icon name="arrow" />
            </Link>
          )}
          {!preview && (
            <div className={styles.coverActions}>
              <ShareButton
                title={business.title}
                path={`/djelatnosti/${business.id}`}
                className={styles.coverControl}
                statusClassName={styles.shareStatus}
              />
              <FavoriteButton businessId={business.id} title={business.title} compact />
              <details
                className={styles.profileOptions}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.currentTarget.open = false;
                    e.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary className={styles.coverControl} aria-label={t("Opcije djelatnosti")}>
                  <Icon name="more" />
                </summary>
                <Link className={styles.reportLink} href={reportUrl("business", business.id)}>
                  <Icon name="shield" /> {t("Prijavi djelatnost")}
                </Link>
              </details>
            </div>
          )}
        </div>
      </div>

      <header className={styles.identity}>
        <div className={styles.identityTop}>
          <div className={styles.logo}>
            <BusinessLogo src={logo?.src} alt={logo ? t(logo.alt) : ""} sizes="54px" priority />
          </div>
          <div className={styles.title}>
            <Title>
              <bdi>{business.title}</bdi>
              {business.verified && <VerificationBadge kind="business" />}
            </Title>
            {(taxonomy || hasLocation) && (
              <p className={styles.summary}>
                {taxonomy}
                {taxonomy && hasLocation && " · "}
                {hasLocation && <bdi>{shortLocation}</bdi>}
              </p>
            )}
          </div>
        </div>
        <div className={styles.facts}>
          {business.details?.hours && <BusinessHoursSheet details={business.details} />}
          {Boolean(business.reviews?.count) &&
            (preview ? (
              <span className={styles.reviewLink}>
                <BusinessRating summary={business.reviews} inline />
              </span>
            ) : (
              <a className={styles.reviewLink} href="#recenzije">
                <BusinessRating summary={business.reviews} inline />
              </a>
            ))}
        </div>
        <div className={styles.quickActions}>
          {links.phone ? (
            <a
              className={styles.secondary}
              href={links.phone}
              onClick={preview ? undefined : () => sendTouch(business.id, "call")}
            >
              <Icon name="phone" />
              {t("Pozovi")}
            </a>
          ) : links.email ? (
            <a className={styles.secondary} href={links.email} aria-label={t("Pošalji email")}>
              <Icon name="mail" />
              {t("Email")}
            </a>
          ) : (
            links.website && (
              <a
                className={styles.secondary}
                href={links.website}
                aria-label={t("Web stranica")}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="external" />
                Web
              </a>
            )
          )}
          {contactMessage && (
            <Link
              className={styles.primary}
              href={contactMessage}
              aria-label={t("Pošalji poruku")}
              onClick={preview ? undefined : () => sendTouch(business.id, "message")}
            >
              <Icon name="message" /> {t("Poruka")}
            </Link>
          )}
          {driving && !preview ? (
            <Link
              className={styles.secondary}
              href={`/djelatnosti/${business.id}/uputstva`}
              onClick={() => sendTouch(business.id, "map")}
            >
              <Icon name="route" />
              {t("Uputstva")}
            </Link>
          ) : driving ? (
            <a
              className={styles.secondary}
              href={driving}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="route" />
              {t("Uputstva")}
            </a>
          ) : (
            hasLocation && (
              <a className={styles.secondary} href="#business-location">
                <Icon name="pin" />
                {t("Lokacija")}
              </a>
            )
          )}
        </div>
        {actions && <div className={styles.extraActions}>{actions}</div>}
      </header>
      {sponsor}

      <div className={styles.layout}>
        <div className={styles.details}>
          {hasAbout && (
            <section
              className={styles.section}
              id="business-about"
              aria-labelledby="business-about-heading"
            >
              <div className={styles.sectionHeading}>
                <h2 id="business-about-heading">{t("O djelatnosti")}</h2>
              </div>
              {business.description?.trim() && (
                <p className={styles.description} dir="auto">
                  {business.description}
                </p>
              )}
              <BusinessAmenities details={business.details} />
            </section>
          )}

          {offerSections}
          {hasAppointments && (
            <section
              className={styles.appointments}
              id="business-appointments"
              aria-label={t("Termini")}
            >
              {children}
            </section>
          )}

          {gallery.length > 0 && (
            <section
              className={styles.section}
              id="business-gallery"
              aria-labelledby="business-gallery-heading"
            >
              <div className={styles.sectionHeading}>
                <h2 id="business-gallery-heading">{t("Galerija")}</h2>
              </div>
              <BusinessGallery key={business.id} businessId={business.id} photos={gallery} />
            </section>
          )}

          {hasLocation && (
            <section
              className={styles.section}
              id="business-location"
              aria-labelledby="business-location-heading"
            >
              <div className={styles.sectionHeading}>
                <h2 id="business-location-heading">{t("Lokacija")}</h2>
              </div>
              <p className={styles.address} dir="auto">
                {location}
              </p>
              {point && <PublicProfileMap point={point} category={business.categoryName} />}
              {(driving || walking) && (
                <div className={styles.directions}>
                  <p>
                    {t("Upute na Google Mapsu")} <Icon name="external" />
                  </p>
                  <div>
                    {driving && (
                      <a href={driving} target="_blank" rel="noopener noreferrer">
                        <Icon name="car" />
                        {t("Automobilom")}
                        <Icon name="external" />
                      </a>
                    )}
                    {walking && (
                      <a href={walking} target="_blank" rel="noopener noreferrer">
                        <Icon name="pin" />
                        {t("Pješice")}
                        <Icon name="external" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
          {!preview && <BusinessReviews key={business.id} businessId={business.id} />}
        </div>

        {hasContact && (
          <aside
            className={styles.contact}
            id="business-contact"
            aria-labelledby="business-contact-heading"
          >
            <div className={styles.contactHeading}>
              <h2 id="business-contact-heading">{t("Kontakt")}</h2>
            </div>
            {links.phone && (
              <a className={styles.contactRow} href={links.phone}>
                <Icon name="phone" />
                <span>
                  <small>{t("Telefon")}</small>
                  <strong>{displayPhone(business.contactPhone)}</strong>
                </span>
                <Icon name="chevron" />
              </a>
            )}
            {links.email && (
              <a className={styles.contactRow} href={links.email}>
                <Icon name="mail" />
                <span>
                  <small>{t("Email")}</small>
                  <strong>{business.contactEmail}</strong>
                </span>
                <Icon name="chevron" />
              </a>
            )}
            {links.website && (
              <a
                className={styles.contactRow}
                href={links.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="external" />
                <span>
                  <small>{t("Web stranica")}</small>
                  <strong>{t("Posjeti stranicu")}</strong>
                </span>
                <Icon name="external" />
              </a>
            )}
            {!links.phone && !links.email && !links.website && contactMessage && (
              <Link className={styles.contactRow} href={contactMessage}>
                <Icon name="message" />
                <span>{t("Pošalji poruku djelatnosti")}</span>
                <Icon name="chevron" />
              </Link>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}
