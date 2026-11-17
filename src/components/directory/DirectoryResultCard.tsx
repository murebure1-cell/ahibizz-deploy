import Image from "next/image";
import Link from "next/link";
import { messageLink } from "../../lib/messaging";
import {
  businessLocationLabel,
  type PublicBusinessView,
  publicBusinessPoint,
  safeBusinessImage,
} from "../../lib/public-business";
import { Icon } from "../Icon";
import { BusinessAmenities, BusinessOpenStatus } from "./BusinessDetails";
import { BusinessLogo } from "./BusinessLogo";
import { BusinessRating } from "./BusinessRating";
import styles from "./directory-card.module.css";

export function DirectoryResultCard({ business }: { business: PublicBusinessView }) {
  const logo = safeBusinessImage(business.logo);
  const image = safeBusinessImage(business.image);
  const profile = `/djelatnosti/${business.id}`;
  const monogram = business.title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase("bs");
  const hasLocation = Boolean(
    business.addressLine?.trim() || business.city?.trim() || business.countryCode?.trim(),
  );
  const hasMap = Boolean(publicBusinessPoint(business));
  const category = business.subcategoryName || business.categoryName;
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <Link
          href={profile}
          className={styles.cover}
          data-photo={Boolean(image)}
          aria-label={`Otvori ${business.title}`}
        >
          {image ? (
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(max-width: 650px) calc(100vw - 36px), (max-width: 1200px) 46vw, 560px"
              unoptimized
            />
          ) : logo ? (
            <span className={styles.coverLogo} aria-hidden="true">
              <BusinessLogo src={logo.src} alt="" monogram={monogram} sizes="180px" />
            </span>
          ) : (
            <span className={styles.coverMonogram} aria-hidden="true">
              {monogram || "A"}
            </span>
          )}
          <span
            className={styles.brand}
            data-rating={Boolean(business.reviews?.count)}
            aria-hidden="true"
          >
            <Image src="/brand/ahi-logo-white.svg" alt="" width={88} height={24} unoptimized />
          </span>
        </Link>
        <span className={styles.openStatus}>
          <BusinessOpenStatus details={business.details} />
        </span>
        {Boolean(business.reviews?.count) && (
          <span className={styles.rating}>
            <BusinessRating summary={business.reviews} />
          </span>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.logo} aria-hidden="true">
          {logo ? (
            <BusinessLogo src={logo.src} alt="" monogram={monogram} sizes="72px" />
          ) : (
            <span>{monogram || "A"}</span>
          )}
        </div>
        <header className={styles.identity}>
          <h2>
            <Link href={profile} title={business.title}>
              {business.title}
            </Link>
            {business.verified && (
              <span className={styles.verified} title="Verifikovana djelatnost">
                <Icon name="check" />
                <span className={styles.srOnly}>Verifikovana djelatnost</span>
              </span>
            )}
          </h2>
          {hasLocation && (
            <p className={styles.location}>
              <Icon name="pin" />
              <span>{businessLocationLabel(business)}</span>
            </p>
          )}
        </header>
        {business.description?.trim() && (
          <p className={styles.description}>{business.description}</p>
        )}
        <BusinessAmenities details={business.details} compact />
      </div>

      <footer className={styles.footer}>
        {category && (
          <span
            className={styles.category}
            title={[business.categoryName, business.subcategoryName].filter(Boolean).join(" · ")}
          >
            <span className={styles.categoryIcon}>
              <Icon name="shop" />
            </span>
            <span>{category}</span>
          </span>
        )}
        <div className={styles.actions}>
          <Link
            href={messageLink({ kind: "business", targetId: business.id })}
            aria-label={`Pošalji poruku — ${business.title}`}
            title="Pošalji poruku"
          >
            <Icon name="message" />
          </Link>
          {hasMap && (
            <Link
              href={`${profile}#business-location`}
              aria-label={`Prikaži lokaciju — ${business.title}`}
              title="Prikaži lokaciju"
            >
              <Icon name="pin" />
            </Link>
          )}
          <Link
            href={profile}
            aria-label={`Pogledaj profil — ${business.title}`}
            title="Pogledaj profil"
          >
            <Icon name="arrow" />
          </Link>
        </div>
      </footer>
    </article>
  );
}
