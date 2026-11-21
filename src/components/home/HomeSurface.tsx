import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { HomeCategory } from "../../lib/home";
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
}: {
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
            Pogledaj sve <Icon name="chevron" />
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

function HomeArtwork({ kind }: { kind: "promotion" | "credits" }) {
  return (
    <div className={styles.artwork} aria-hidden="true">
      <Image
        src={`/brand/home-${kind}-20261121.webp`}
        alt=""
        fill
        sizes="(max-width: 600px) 100vw, 580px"
        unoptimized
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
  creditsHref,
  after,
}: {
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
  creditsHref?: string;
  after?: ReactNode;
}) {
  const titles = design.sectionTitles ?? {};
  const featuredTitle = titles.featured || "Istaknute djelatnosti";
  const newestTitle = titles.newest || "Novi na AhiBizzu";
  const sections: Record<string, ReactNode> = {
    featured:
      slots?.featured ??
      (featured?.length ? (
        <HomeListingsSection kind="featured" title={featuredTitle} href={featuredHref}>
          <HomeBusinessRail label={featuredTitle} cards={featured} />
        </HomeListingsSection>
      ) : null),
    newest:
      slots?.newest ??
      (newest.length ? (
        <HomeListingsSection kind="newest" title={newestTitle}>
          <HomeBusinessRail label={newestTitle} cards={newest} />
        </HomeListingsSection>
      ) : null),
    reels: discovery && (
      <div className={`${styles.container} ${styles.reelStrip}`} data-design="home-reels">
        {discovery}
      </div>
    ),
    ad: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.ad}`}
        aria-label="Oglasni prostor"
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
          <span className={styles.kicker}>{banner ? "SPONZORIRANO" : "OGLASNI PROSTOR"}</span>
          <h2>{banner?.title || titles.ad || "Tvoj posao.\nNa pravom mjestu."}</h2>
          {banner?.city && <small>{banner.city}</small>}
        </div>
        <Link
          href={banner ? `/djelatnosti/${banner.id}` : advertisingHref}
          className={`${styles.button} ${styles.buttonDark}`}
        >
          {banner ? "Pogledaj djelatnost" : "Oglasi se"} <Icon name="chevron" />
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
        title={titles.nearby || "Djelatnosti u blizini"}
        control={nearbyControl}
        before={nearbyBefore}
      >
        <HomeArtwork kind="promotion" />
        {nearby}
      </HomeNearbySection>
    ),
    logos: <HomeLogoMarquee title={titles.logos} />,
    promotion: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.callout}`}
        data-design="home-promotion"
        aria-labelledby="promotion-heading"
      >
        <Link
          href="/oglasavanje"
          className={styles.calloutLink}
          aria-labelledby="promotion-heading"
        >
          <span aria-hidden="true" className={styles.calloutIcon}>
            <Icon name="star" />
          </span>
          <h2 id="promotion-heading">{titles.promotion || "Istakni svoju djelatnost"}</h2>
          <Icon name="chevron" className={styles.calloutArrow} />
        </Link>
      </section>
    ),
    credits: !IS_PLAY_EDITION && (
      <section
        className={`${styles.container} ${styles.credits}`}
        data-design="home-credits"
        aria-labelledby="credits-heading"
      >
        <HomeArtwork kind="credits" />
        <div className={styles.creditsIcon} aria-hidden="true">
          a<span>c</span>
        </div>
        <div>
          <span className={styles.kicker}>AHI CREDITS</span>
          <h2 id="credits-heading">{titles.credits || "Daj svom poslu\nviše prostora."}</h2>
        </div>
        {creditsHref ? (
          <Link href={creditsHref} className={styles.button}>
            Moji krediti <Icon name="chevron" />
          </Link>
        ) : (
          <span className={styles.preparing}>U pripremi</span>
        )}
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
            {design.heroTitle.endsWith(".") ? (
              <>
                {design.heroTitle.slice(0, -1)}
                <span>.</span>
              </>
            ) : (
              design.heroTitle
            )}
          </h1>
          {design.heroSubtitle && <p className={styles.heroSubtitle}>{design.heroSubtitle}</p>}
          <Form action={searchAction} className={styles.search} data-design="home-search">
            <label>
              <Icon name="search" />
              <span className={styles.srOnly}>Naziv ili usluga</span>
              <input type="search" name="q" placeholder="Šta tražiš?" maxLength={120} />
            </label>
            <label className={styles.searchPlace}>
              <Icon name="pin" />
              <span className={styles.srOnly}>Grad ili mjesto</span>
              <input
                name={placeField}
                placeholder="Grad ili mjesto"
                defaultValue={place}
                maxLength={100}
              />
            </label>
            <button
              type="submit"
              className={styles.searchSubmit}
              aria-label="Pretraži djelatnosti"
              data-design="home-search-submit"
            >
              <Icon name="search" />
              <span>Pretraži</span>
            </button>
          </Form>
        </div>
      </section>
      {slots?.categories ?? (
        <HomeCategories
          categories={categories}
          searchAction={
            place ? `${searchAction}?${new URLSearchParams({ [placeField]: place })}` : searchAction
          }
        />
      )}
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
