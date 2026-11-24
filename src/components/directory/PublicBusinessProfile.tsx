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
import { BusinessAmenities, BusinessHours } from "./BusinessDetails";
import { BusinessGallery } from "./BusinessGallery";
import { BusinessLogo } from "./BusinessLogo";
import { BusinessRating } from "./BusinessRating";
import { PublicProfileMap } from "./PublicProfileMap";
import styles from "./public-profile.module.css";

export function PublicBusinessProfile({
  business,
  backHref = "/pretraga",
  preview = false,
  children,
  actions,
  messageHref,
  offerLinks,
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
  const taxonomy = [business.categoryName, business.subcategoryName]
    .flatMap((name) => (name ? [t(name)] : []))
    .join(" · ");
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
      {backHref !== null && (
        <nav className={styles.breadcrumb} aria-label={t("Povratak na djelatnosti")}>
          <Link href={backHref}>
            <Icon name="arrow" />{" "}
            {backHref.startsWith("/pretraga?") ? t("Nazad na rezultate") : t("Sve djelatnosti")}
          </Link>
          {business.city && <span dir="auto">{business.city}</span>}
        </nav>
      )}

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
        {!preview && (
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
            <summary aria-label={t("Opcije djelatnosti")}>
              <span aria-hidden="true">•••</span>
            </summary>
            <Link className={styles.reportLink} href={reportUrl("business", business.id)}>
              <Icon name="shield" /> {t("Prijavi djelatnost")}
            </Link>
          </details>
        )}
      </div>

      <header className={styles.identity}>
        <div className={styles.logo}>
          <BusinessLogo src={logo?.src} alt={logo ? t(logo.alt) : ""} sizes="72px" priority />
        </div>
        <div className={styles.title}>
          {taxonomy && <p className={styles.category}>{taxonomy}</p>}
          <Title>
            <bdi>{business.title}</bdi>
            {business.verified && <VerificationBadge kind="business" />}
          </Title>
          {hasLocation && (
            <p className={styles.locationSummary}>
              <Icon name="pin" />
              <bdi>{location}</bdi>
            </p>
          )}
          {Boolean(business.reviews?.count) &&
            (preview ? (
              <span className={styles.reviewLink}>
                <BusinessRating summary={business.reviews} />
              </span>
            ) : (
              <a className={styles.reviewLink} href="#recenzije">
                <BusinessRating summary={business.reviews} />
              </a>
            ))}
        </div>
        <div className={styles.quickActions}>
          {actions}
          {!preview && <FavoriteButton businessId={business.id} title={business.title} />}
          {contactMessage && (
            <Link
              className={styles.secondary}
              href={contactMessage}
              aria-label={t("Pošalji poruku")}
            >
              <Icon name="message" /> {t("Poruka")}
            </Link>
          )}
          {links.phone ? (
            <a className={styles.primary} href={links.phone}>
              <Icon name="phone" />
              {t("Pozovi")}
            </a>
          ) : links.email ? (
            <a className={styles.primary} href={links.email} aria-label={t("Pošalji email")}>
              <Icon name="mail" />
              {t("Email")}
            </a>
          ) : (
            links.website && (
              <a
                className={styles.primary}
                href={links.website}
                aria-label={t("Web stranica")}
                target="_blank"
                rel="noopener noreferrer"
              >
                Web
                <Icon name="external" />
              </a>
            )
          )}
        </div>
      </header>
      {sponsor}

      <nav className={styles.sectionNavigation} aria-label={t("Na ovoj stranici")}>
        {hasAbout && <a href="#business-about">{t("O djelatnosti")}</a>}
        {business.details?.hours && <a href="#business-hours">{t("Radno vrijeme")}</a>}
        {offerLinks}
        {hasAppointments && (
          <a className={styles.appointmentsLink} href="#business-appointments">
            {t("Termini")}
          </a>
        )}
        {gallery.length > 0 && <a href="#business-gallery">{t("Galerija")}</a>}
        {hasLocation && <a href="#business-location">{t("Lokacija")}</a>}
        {!preview && <a href="#recenzije">{t("Recenzije")}</a>}
        {hasContact && <a href="#business-contact">{t("Kontakt")}</a>}
      </nav>

      <div className={styles.layout}>
        <div className={styles.details}>
          {hasAbout && (
            <section
              className={styles.section}
              id="business-about"
              aria-labelledby="business-about-heading"
            >
              <div className={styles.sectionHeading}>
                <span>
                  <Icon name="shop" />
                </span>
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

          {business.details?.hours && (
            <section
              className={styles.section}
              id="business-hours"
              aria-labelledby="business-hours-heading"
            >
              <div className={styles.sectionHeading}>
                <span>
                  <Icon name="clock" />
                </span>
                <h2 id="business-hours-heading">{t("Radno vrijeme")}</h2>
              </div>
              <BusinessHours details={business.details} />
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
                <span>
                  <Icon name="pin" />
                </span>
                <h2 id="business-location-heading">{t("Lokacija")}</h2>
              </div>
              <p className={styles.address} dir="auto">
                {location}
              </p>
              {point && <PublicProfileMap point={point} logoUrl={logo?.src} />}
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
              <span>
                <Icon name="phone" />
              </span>
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
            {point && (
              <a className={styles.contactLocation} href="#business-location">
                <Icon name="pin" />
                <span>{t("Pogledaj lokaciju na karti")}</span>
                <Icon name="arrow" />
              </a>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}
