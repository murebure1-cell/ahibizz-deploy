import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
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
  slots?: {
    categories?: ReactNode;
    featured?: ReactNode;
    newest?: ReactNode;
    nearby?: ReactNode;
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
  };

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
      {design.homeOrder.map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}
      {after}
    </main>
  );
}
