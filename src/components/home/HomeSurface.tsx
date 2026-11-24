import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { HomeCategory } from "../../lib/home";
import { msg, type Translate, translator } from "../../lib/i18n/translate";
import {
  defaultVisualDesign,
  homeCoverId,
  homeCoverPhotos,
  type VisualDesign,
} from "../../lib/visual-design";
import { Icon, type IconName } from "../Icon";
import { HomeCategories } from "./HomeCategories";
import { HomeLogoMarquee } from "./HomeLogoMarquee";
import { HomeRail } from "./HomeRail";
import styles from "./home.module.css";

export function HomeBusinessRail({
  cards,
  label,
  expanded = false,
}: {
  cards: ReactNode[];
  label: string;
  expanded?: boolean;
}) {
  return expanded ? (
    <div className={`${styles.nearbyGrid} ${styles.fullWidth}`}>{cards}</div>
  ) : (
    <HomeRail listings label={label} className={styles.businessGrid}>
      {cards}
    </HomeRail>
  );
}

export function HomeEmptyState({
  children,
  icon = "shop",
}: {
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={styles.empty}>
      <span>
        <Icon name={icon} />
      </span>
      <p>{children}</p>
    </div>
  );
}

export function HomeListingsSection({
  title,
  href,
  kind,
  children,
  t = translator("bs"),
}: {
  t?: Translate;
  title: string;
  href?: string;
  kind: "featured" | "newest";
  children: ReactNode;
}) {
  const id = `home-${kind}-heading`;
  return (
    <section
      className={`${styles.container} ${styles.section}`}
      data-design={`home-${kind}`}
      aria-labelledby={id}
    >
      <div className={styles.sectionHeading}>
        <h2 id={id} className={styles.listingTitle}>
          <span className={styles.sectionGlyph}>
            <Icon name={kind === "newest" ? "plus" : "star"} />
          </span>
          {title}
        </h2>
        {href && (
          <Link href={href} className={styles.subtleLink}>
            {t("Sve djelatnosti")}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function HomeNearbySection({
  title,
  control,
  before,
  children,
}: {
  title: string;
  control?: ReactNode;
  before?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      className={`${styles.container} ${styles.section}`}
      aria-labelledby="nearby-heading"
      data-design="home-nearby"
    >
      <div className={styles.sectionHeading}>
        <h2 id="nearby-heading">{title}</h2>
        {control}
      </div>
      {before}
      <div className={styles.nearbyGrid}>{children}</div>
    </section>
  );
}

function HomeArtwork({ kind }: { kind: "promotion" }) {
  return (
    <div className={styles.artwork} aria-hidden="true">
      <Image
        src={`/brand/home-${kind}-20261121.webp`}
        alt=""
        fill
        sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1252px) calc(100vw - 72px), 1180px"
        loading="lazy"
        fetchPriority="low"
      />
    </div>
  );
}

/** The live directory and the isolated fixture use one visual surface with separate data adapters. */
export function HomeSurface({
  design = defaultVisualDesign(),
  searchAction,
  placeField,
  place = "",
  categories = [],
  discovery,
  featured,
  featuredHref,
  newest = [],
  nearby,
  nearbyControl,
  nearbyBefore,
  advertisingHref,
  banner,
  slots,
  after,
  t = translator("bs"),
}: {
  t?: Translate;
  design?: VisualDesign;
  searchAction: "/pretraga" | "/pregled/pretraga";
  placeField: "mjesto" | "place";
  place?: string;
  categories?: readonly HomeCategory[];
  discovery?: ReactNode;
  featured?: ReactNode[];
  featuredHref?: string;
  newest?: ReactNode[];
  nearby?: ReactNode;
  nearbyControl?: ReactNode;
  nearbyBefore?: ReactNode;
  advertisingHref: string;
  banner?: { id: string; title: string; city: string; image: string | null } | null;
  slots?: {
    categories?: ReactNode;
    featured?: ReactNode;
    newest?: ReactNode;
    nearby?: ReactNode;
    floatingAd?: ReactNode;
    inlineAd?: (fallback: ReactNode) => ReactNode;
  };
  after?: ReactNode;
}) {
  const titles = design.sectionTitles ?? {};
  const featuredTitle = t(titles.featured || msg("Istaknute djelatnosti"));
  const newestTitle = t(titles.newest || msg("Novi na AhiBizzu"));
  const heroTitle = t(design.heroTitle);
  const sections: Record<string, ReactNode> = {
    featured:
      slots?.featured ??
      (featured?.length ? (
        <HomeListingsSection kind="featured" title={featuredTitle} href={featuredHref} t={t}>
          <HomeBusinessRail label={featuredTitle} cards={featured} />
        </HomeListingsSection>
      ) : null),
    newest:
      slots?.newest ??
      (newest.length ? (
        <HomeListingsSection kind="newest" title={newestTitle} t={t}>
          <HomeBusinessRail label={newestTitle} cards={newest} />
        </HomeListingsSection>
      ) : null),
    reels: discovery && (
      <div className={`${styles.container} ${styles.reelStrip}`} data-design="home-reels">
        {discovery}
      </div>
    ),
    ad: (Boolean(banner) || !IS_PLAY_EDITION) && (
      <section
        className={`${styles.container} ${styles.ad}`}
        aria-label={t("Oglasni prostor")}
        data-design="home-ad"
      >
        {banner?.image && (
          <div aria-hidden="true" className={styles.sponsorBackdrop}>
            <Image
              src={banner.image}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 800px) 100vw, 1100px"
            />
          </div>
        )}
        <div className={banner?.image ? styles.adOnPhoto : undefined}>
          <span className={styles.kicker}>{banner ? t("SPONZORIRANO") : t("OGLASNI PROSTOR")}</span>
          <h2>{banner?.title || t(titles.ad || msg("Tvoj posao.\nNa pravom mjestu."))}</h2>
          {banner?.city && <small>{banner.city}</small>}
        </div>
        <Link
          href={banner ? `/djelatnosti/${banner.id}` : advertisingHref}
          className={`${styles.button} ${styles.buttonDark}`}
        >
          {banner ? t("Pogledaj djelatnost") : t("Oglasi se")} <Icon name="chevron" />
        </Link>
        {!banner && (
          <span className={styles.adMark} aria-hidden="true">
            a.
          </span>
        )}
      </section>
    ),
    nearby: slots?.nearby ?? (
      <HomeNearbySection
        title={t(titles.nearby || msg("Djelatnosti u blizini"))}
        control={nearbyControl}
        before={nearbyBefore}
      >
        {nearby}
      </HomeNearbySection>
    ),
    logos: <HomeLogoMarquee title={titles.logos ? t(titles.logos) : undefined} t={t} />,
    promotion: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.callout}`}
        data-design="home-promotion"
        aria-labelledby="promotion-heading"
      >
        <HomeArtwork kind="promotion" />
        <Link href="/istakni" className={styles.calloutLink} aria-labelledby="promotion-heading">
          <span aria-hidden="true" className={styles.calloutIcon}>
            <Icon name="star" />
          </span>
          <h2 id="promotion-heading">{t(titles.promotion || msg("Istakni svoju djelatnost"))}</h2>
          <Icon name="chevron" className={styles.calloutArrow} />
        </Link>
      </section>
    ),
  };
  const hasAd = design.homeOrder.includes("ad");

  return (
    <main id="glavni-sadrzaj" className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-title" data-design="home-hero">
        <Image
          className={styles.heroPhoto}
          data-design="home-photo"
          src={homeCoverPhotos[homeCoverId(design.heroImage)].src}
          alt=""
          fill
          sizes="100vw"
          fetchPriority="high"
        />
        <div className={`${styles.container} ${styles.heroContent}`}>
          <h1 id="home-title" data-design="home-title">
            {heroTitle.endsWith(".") ? (
              <>
                {heroTitle.slice(0, -1)}
                <span>.</span>
              </>
            ) : (
              heroTitle
            )}
          </h1>
          {design.heroSubtitle && <p className={styles.heroSubtitle}>{t(design.heroSubtitle)}</p>}
          <Form action={searchAction} className={styles.search} data-design="home-search">
            <label>
              <Icon name="search" />
              <span className={styles.srOnly}>{t("Naziv ili usluga")}</span>
              <input type="search" name="q" placeholder={t("Šta tražiš?")} maxLength={120} />
            </label>
            <label className={styles.searchPlace}>
              <Icon name="pin" />
              <span className={styles.srOnly}>{t("Grad ili mjesto")}</span>
              <input
                name={placeField}
                placeholder={t("Grad ili mjesto")}
                defaultValue={place}
                maxLength={100}
              />
            </label>
            <button
              type="submit"
              className={styles.searchSubmit}
              aria-label={t("Pretraži djelatnosti")}
              data-design="home-search-submit"
            >
              <Icon name="search" />
              <span>{t("Pretraži")}</span>
            </button>
          </Form>
        </div>
      </section>
      {slots?.categories ?? <HomeCategories t={t} categories={categories} />}
      {hasAd && slots?.floatingAd}
      {design.homeOrder.map((id) => (
        <Fragment key={id}>
          {id === "ad" && slots?.inlineAd ? slots.inlineAd(sections.ad) : sections[id]}
        </Fragment>
      ))}
      {after}
    </main>
  );
}
