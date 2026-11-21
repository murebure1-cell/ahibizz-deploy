import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { PageAds } from "../../lib/ad-render";
import { IS_PLAY_EDITION } from "../../lib/distribution";
import type { HomeCategory } from "../../lib/home";
import {
  defaultVisualDesign,
  homeCoverId,
  homeCoverPhotos,
  type VisualDesign,
} from "../../lib/visual-design";
import { Icon, type IconName } from "../Icon";
import { CampaignAd } from "../marketing/CampaignAd";
import { HomeCategories } from "./HomeCategories";
import { HomeLogoMarquee } from "./HomeLogoMarquee";
import { HomeRail } from "./HomeRail";
import styles from "./home.module.css";
import nearbyStyles from "./nearby.module.css";

export function HomeNearbyGroups({
  local,
  organic,
  expanded = false,
}: {
  local: ReactNode[];
  organic: ReactNode[];
  expanded?: boolean;
}) {
  function show(items: ReactNode[], label: string) {
    return expanded ? (
      <div className={styles.nearbyGrid}>{items}</div>
    ) : (
      <HomeRail listings label={label} className={styles.businessGrid}>
        {items.slice(0, 4)}
      </HomeRail>
    );
  }
  return (
    <>
      <div className={nearbyStyles.group} data-design="home-local-featured">
        <h3>Istaknuto na tvojoj lokaciji</h3>
        {local.length ? (
          show(local, "Istaknuto na tvojoj lokaciji")
        ) : (
          <p className={styles.availability}>Trenutno nema lokalnih isticanja.</p>
        )}
      </div>
      {organic.length > 0 && (
        <div className={nearbyStyles.group}>
          <h3>Djelatnosti u blizini</h3>
          {show(organic, "Djelatnosti u blizini")}
        </div>
      )}
    </>
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

/** The live directory and the isolated fixture use one visual surface with separate data adapters. */
export function HomeSurface({
  design = defaultVisualDesign(),
  searchAction,
  placeField,
  place = "",
  categories,
  discovery,
  featured,
  featuredHref,
  categoryFeatured = [],
  categoryAvailable = true,
  nearby,
  nearbyControl,
  nearbyBefore,
  advertisingHref,
  banner,
  campaigns,
  creditsHref,
  after,
}: {
  design?: VisualDesign;
  searchAction: "/pretraga" | "/pregled/pretraga";
  placeField: "mjesto" | "place";
  place?: string;
  categories: readonly HomeCategory[];
  discovery?: ReactNode;
  featured?: ReactNode;
  featuredHref: string;
  categoryFeatured?: ReactNode[];
  categoryAvailable?: boolean;
  nearby: ReactNode;
  nearbyControl: ReactNode;
  nearbyBefore?: ReactNode;
  advertisingHref: string;
  banner?: { id: string; title: string; city: string; image: string | null } | null;
  campaigns?: PageAds;
  creditsHref?: string;
  after?: ReactNode;
}) {
  const titles = design.sectionTitles ?? {};
  const sections: Record<string, ReactNode> = {
    featured: featured && (
      <section
        className={`${styles.container} ${styles.section}`}
        data-design="home-featured"
        aria-labelledby="featured-heading"
      >
        <div className={styles.sectionHeading}>
          <h2 id="featured-heading">{titles.featured || "Istaknute djelatnosti"}</h2>
          <Link href={featuredHref} className={styles.subtleLink}>
            Pogledaj sve <Icon name="chevron" />
          </Link>
        </div>
        <HomeRail
          listings
          label={titles.featured || "Istaknute djelatnosti"}
          className={styles.businessGrid}
        >
          {featured}
        </HomeRail>
      </section>
    ),
    categoryFeatured: (
      <section
        className={`${styles.container} ${styles.section}`}
        data-design="home-category-featured"
        data-empty={categoryFeatured.length === 0 || undefined}
        aria-labelledby="category-featured-heading"
      >
        <div className={styles.sectionHeading}>
          <h2 id="category-featured-heading">
            {titles.categoryFeatured || "Istaknuto u kategoriji"}
          </h2>
          {categoryFeatured.length > 0 && (
            <Link
              href={searchAction === "/pretraga" ? "/pretraga?istaknute=kategorija" : searchAction}
              className={styles.subtleLink}
            >
              Pogledaj sve <Icon name="chevron" />
            </Link>
          )}
        </div>
        {categoryFeatured.length > 0 ? (
          <HomeRail listings label="Istaknuto u kategoriji" className={styles.businessGrid}>
            {categoryFeatured}
          </HomeRail>
        ) : (
          <p className={styles.availability}>
            {categoryAvailable ? "Nema aktivnih isticanja." : "Imenik trenutno nije dostupan."}
          </p>
        )}
      </section>
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
    nearby: (
      <section
        className={`${styles.container} ${styles.section}`}
        aria-labelledby="nearby-heading"
        data-design="home-nearby"
      >
        <div className={styles.sectionHeading}>
          <h2 id="nearby-heading">{titles.nearby || "Blizu tebe"}</h2>
          {nearbyControl}
        </div>
        {nearbyBefore}
        <div className={styles.nearbyGrid}>{nearby}</div>
      </section>
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
    community: (
      <section
        className={`${styles.container} ${styles.callout} ${styles.community}`}
        data-design="home-community"
        aria-labelledby="community-heading"
      >
        <Link href="/o-nama" className={styles.calloutLink} aria-labelledby="community-heading">
          <span aria-hidden="true" className={styles.calloutIcon}>
            <Icon name="people" />
          </span>
          <h2 id="community-heading">{titles.community || "AhiBizz zajednica"}</h2>
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
  const reelStrip = discovery && (
    <div className={`${styles.container} ${styles.reelStrip}`}>{discovery}</div>
  );
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
      <HomeCategories
        categories={categories}
        sponsor={
          campaigns && (campaigns.icon.mobile || campaigns.icon.desktop) ? (
            <CampaignAd candidates={campaigns.icon} />
          ) : null
        }
        searchAction={
          place ? `${searchAction}?${new URLSearchParams({ [placeField]: place })}` : searchAction
        }
      />
      {!hasAd && reelStrip}
      {campaigns && hasAd && <CampaignAd candidates={campaigns.main} region="elsewhere" />}
      {design.homeOrder.map((id) => (
        <Fragment key={id}>
          {id === "ad" && campaigns && (campaigns.main.mobile || campaigns.main.desktop) ? (
            <CampaignAd candidates={campaigns.main} fallback={sections.ad} region="inline" />
          ) : (
            sections[id]
          )}
          {id === "ad" && reelStrip}
        </Fragment>
      ))}
      {after}
    </main>
  );
}
