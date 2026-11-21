"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { messageLink } from "../../lib/messaging";
import {
  businessContactLinks,
  businessDirections,
  businessLocationLabel,
  type PublicBusinessView,
  publicBusinessPoint,
  safeBusinessImage,
} from "../../lib/public-business";
import { reportUrl } from "../../lib/support-requests";
import { FavoriteButton } from "../favorites/FavoriteButton";
import { Icon } from "../Icon";
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
    ? businessLocationLabel(business)
    : point
      ? "Lokacija je označena na karti."
      : businessLocationLabel(business);
  const taxonomy = [business.categoryName, business.subcategoryName].filter(Boolean).join(" · ");
  const monogram = business.title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase("bs");
  const photo = safeBusinessImage(business.image, preview);
  const logo = safeBusinessImage(business.logo, preview);
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
      aria-label="Poslovni profil"
      className={styles.profile}
      data-design="business-profile"
      data-preview={preview || undefined}
      data-embedded={backHref === null || undefined}
    >
      {backHref !== null && (
        <nav className={styles.breadcrumb} aria-label="Povratak na djelatnosti">
          <Link href={backHref}>
            <Icon name="arrow" />{" "}
            {backHref.startsWith("/pretraga?") ? "Nazad na rezultate" : "Sve djelatnosti"}
          </Link>
          {business.city && <span>{business.city}</span>}
        </nav>
      )}

      <div className={styles.cover} data-design="business-cover" data-photo={Boolean(photo)}>
        {photo ? (
          <Image
            src={photo.src}
            data-design="business-photo"
            alt={photo.alt}
            fill
            sizes="(max-width: 700px) 100vw, 1160px"
            loading="eager"
            fetchPriority="high"
            unoptimized
          />
        ) : (
          <Image
            className={styles.brandMark}
            src="/brand/ahi-logo-white.svg"
            alt=""
            width={144}
            height={39}
            unoptimized
          />
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
            <summary aria-label="Opcije djelatnosti">
              <span aria-hidden="true">•••</span>
            </summary>
            <Link className={styles.reportLink} href={reportUrl("business", business.id)}>
              <Icon name="shield" /> Prijavi djelatnost
            </Link>
          </details>
        )}
      </div>

      <header className={styles.identity}>
        <div className={styles.logo}>
          {logo ? (
            <BusinessLogo src={logo.src} alt={logo.alt} monogram={monogram} sizes="72px" />
          ) : (
            <span aria-hidden="true">{monogram}</span>
          )}
        </div>
        <div className={styles.title}>
          {taxonomy && <p className={styles.category}>{taxonomy}</p>}
          <Title>
            {business.title}
            {business.verified && <VerificationBadge kind="business" />}
          </Title>
          {hasLocation && (
            <p className={styles.locationSummary}>
              <Icon name="pin" />
              {location}
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
              aria-label="Poruka — pošalji poruku"
            >
              <Icon name="message" /> Poruka
            </Link>
          )}
          {links.phone ? (
            <a className={styles.primary} href={links.phone}>
              <Icon name="phone" />
              Pozovi
            </a>
          ) : links.email ? (
            <a className={styles.primary} href={links.email} aria-label="Pošalji email">
              <Icon name="mail" />
              Email
            </a>
          ) : (
            links.website && (
              <a
                className={styles.primary}
                href={links.website}
                aria-label="Web stranica"
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

      <nav className={styles.sectionNavigation} aria-label="Na ovoj stranici">
        {hasAbout && <a href="#business-about">O djelatnosti</a>}
        {business.details?.hours && <a href="#business-hours">Radno vrijeme</a>}
        {offerLinks}
        {hasAppointments && (
          <a className={styles.appointmentsLink} href="#business-appointments">
            Termini
          </a>
        )}
        {gallery.length > 0 && <a href="#business-gallery">Galerija</a>}
        {hasLocation && <a href="#business-location">Lokacija</a>}
        {!preview && <a href="#recenzije">Recenzije</a>}
        {hasContact && <a href="#business-contact">Kontakt</a>}
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
                <h2 id="business-about-heading">O djelatnosti</h2>
              </div>
              {business.description?.trim() && (
                <p className={styles.description}>{business.description}</p>
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
                <h2 id="business-hours-heading">Radno vrijeme</h2>
              </div>
              <BusinessHours details={business.details} />
            </section>
          )}

          {offerSections}
          {hasAppointments && (
            <section
              className={styles.appointments}
              id="business-appointments"
              aria-label="Termini"
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
                <h2 id="business-gallery-heading">Galerija</h2>
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
                <h2 id="business-location-heading">Lokacija</h2>
              </div>
              <p className={styles.address}>{location}</p>
              {point && <PublicProfileMap point={point} logoUrl={logo?.src} />}
              {(driving || walking) && (
                <div className={styles.directions}>
                  <p>
                    Upute na Google Mapsu <Icon name="external" />
                  </p>
                  <div>
                    {driving && (
                      <a href={driving} target="_blank" rel="noopener noreferrer">
                        <Icon name="car" />
                        Automobilom
                        <Icon name="external" />
                      </a>
                    )}
                    {walking && (
                      <a href={walking} target="_blank" rel="noopener noreferrer">
                        <Icon name="pin" />
                        Pješice
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
              <h2 id="business-contact-heading">Kontakt</h2>
            </div>
            {links.phone && (
              <a className={styles.contactRow} href={links.phone}>
                <Icon name="phone" />
                <span>
                  <small>Telefon</small>
                  <strong>{business.contactPhone}</strong>
                </span>
                <Icon name="chevron" />
              </a>
            )}
            {links.email && (
              <a className={styles.contactRow} href={links.email}>
                <Icon name="mail" />
                <span>
                  <small>Email</small>
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
                  <small>Web stranica</small>
                  <strong>Posjeti stranicu</strong>
                </span>
                <Icon name="external" />
              </a>
            )}
            {!links.phone && !links.email && !links.website && contactMessage && (
              <Link className={styles.contactRow} href={contactMessage}>
                <Icon name="message" />
                <span>Pošalji poruku djelatnosti</span>
                <Icon name="chevron" />
              </Link>
            )}
            {point && (
              <a className={styles.contactLocation} href="#business-location">
                <Icon name="pin" />
                <span>Pogledaj lokaciju na karti</span>
                <Icon name="arrow" />
              </a>
            )}
          </aside>
        )}
      </div>
    </article>
  );
}
