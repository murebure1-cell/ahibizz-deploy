import { type ReactNode, Suspense } from "react";
import { DirectoryResultCard } from "../../components/directory/DirectoryResultCard";
import { HomeCategories } from "../../components/home/HomeCategories";
import { HomeFeaturedRail } from "../../components/home/HomeFeaturedRail";
import {
  HomeNearbyControl,
  HomeNearbyProvider,
  HomeNearbyResults,
} from "../../components/home/HomeNearby";
import {
  HomeBusinessRail,
  HomeListingsSection,
  HomeNearbySection,
  HomeSurface,
} from "../../components/home/HomeSurface";
import { CampaignAd } from "../../components/marketing/CampaignAd";
import { RecentReels } from "../../components/reels/ReelShelf";
import type { PageAds } from "../../lib/ad-render";
import { homeCategories, homePlace } from "../../lib/home";
import {
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../server/directory";
import { publicBusinessView } from "../../server/directory/public-view";
import { publicPageAds } from "../../server/marketing/ad-delivery";
import { readPublishedDesign } from "../../server/visual-design-store";

type Categories = Promise<DirectoryCategory[] | null>;
type Listings = Promise<PublicDirectoryBusiness[] | null>;

async function HomeAd({
  data,
  slot,
  fallback,
}: {
  data: Promise<PageAds>;
  slot: "icon" | "inline" | "elsewhere";
  fallback?: ReactNode;
}) {
  const ads = await data;
  const candidates = slot === "icon" ? ads.icon : ads.main;
  if (!candidates.mobile && !candidates.desktop) return fallback;
  return (
    <CampaignAd
      candidates={candidates}
      region={slot === "icon" ? undefined : slot}
      fallback={fallback}
    />
  );
}

async function HomeDirectoryCategories({
  data,
  place,
  href,
  sponsor,
}: {
  data: Categories;
  place: string;
  href: string;
  sponsor: ReactNode;
}) {
  return (
    <HomeCategories
      categories={homeCategories((await data) ?? [], place)}
      searchAction={href}
      sponsor={sponsor}
    />
  );
}

async function HomeNewestListings({
  data,
  example,
  classification,
  title,
}: {
  data: Listings;
  example: Promise<PublicDirectoryBusiness | null>;
  classification: Categories;
  title: string;
}) {
  const [businesses, categories, sample] = await Promise.all([data, classification, example]);
  const cards = (businesses ?? []).map((business) => (
    <DirectoryResultCard
      key={business.id}
      business={publicBusinessView(business, categories ?? [])}
      compact
    />
  ));
  if (sample && !businesses?.some((business) => business.id === sample.id))
    cards.push(
      <DirectoryResultCard
        key={sample.id}
        business={publicBusinessView(sample, categories ?? [])}
        compact
        example
      />,
    );
  if (!cards.length) return null;
  return (
    <HomeListingsSection kind="newest" title={title}>
      <HomeBusinessRail label={title} cards={cards} />
    </HomeListingsSection>
  );
}

async function HomePromotedListings({
  data,
  example,
  classification,
  title,
}: {
  data: Promise<{ items: PublicDirectoryBusiness[]; pageSize: number; hasMore: boolean } | null>;
  example: Promise<PublicDirectoryBusiness | null>;
  classification: Categories;
  title: string;
}) {
  const [businesses, categories, sample] = await Promise.all([data, classification, example]);
  if (!businesses?.items.length && !sample) return null;
  return (
    <HomeListingsSection
      kind="featured"
      title={title}
      href={businesses?.items.length ? "/pretraga?istaknute=sve" : undefined}
    >
      <HomeFeaturedRail
        title={title}
        initial={(businesses?.items ?? []).map((business) =>
          publicBusinessView(business, categories ?? []),
        )}
        initiallyMore={businesses?.hasMore ?? false}
        pageSize={businesses?.pageSize ?? 6}
        categories={categories ?? []}
        example={sample ? publicBusinessView(sample, categories ?? []) : null}
      />
    </HomeListingsSection>
  );
}

async function HomeLocalDirectory({
  data,
  classification,
  place,
  title,
}: {
  data: Listings;
  classification: Categories;
  place: string;
  title: string;
}) {
  const [businesses, categories] = await Promise.all([data, classification]);
  return (
    <HomeNearbyProvider
      key={place}
      categories={categories ?? []}
      initialBusinesses={(businesses ?? []).map((business) =>
        publicBusinessView(business, categories ?? []),
      )}
      available={place ? businesses !== null : categories !== null}
      place={place}
    >
      <HomeNearbySection title={title} control={<HomeNearbyControl />}>
        <HomeNearbyResults exampleId={homeExampleId} />
      </HomeNearbySection>
    </HomeNearbyProvider>
  );
}

export const dynamic = "force-dynamic";
const homeExampleId = "d0914355-b85e-40cd-b570-95eea243dc26";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mjesto?: string | string[] }>;
}) {
  const [params, design] = await Promise.all([searchParams, readPublishedDesign()]);
  const place = homePlace(params.mjesto);
  const service = getPublicDirectoryService();
  const classification =
    service?.categories().then(
      (value) => value.categories,
      () => null,
    ) ?? Promise.resolve(null);
  const local =
    place && service
      ? service.listPublic({ city: place }).then(
          (value) => value.items,
          () => null,
        )
      : Promise.resolve(null);
  const campaigns = publicPageAds({ page: "home", city: place });
  const featured = service?.homeAllPromotions().catch(() => null) ?? Promise.resolve(null);
  const newest = service?.homeNewest().catch(() => null) ?? Promise.resolve(null);
  const example = service?.readPublic(homeExampleId).catch(() => null) ?? Promise.resolve(null);
  const href = place ? `/pretraga?${new URLSearchParams({ mjesto: place })}` : "/pretraga";
  const titles = design.sectionTitles ?? {};
  const nearbyTitle = titles.nearby || "Djelatnosti u blizini";
  return (
    <HomeSurface
      design={design}
      searchAction="/pretraga"
      placeField="mjesto"
      place={place}
      discovery={
        <Suspense fallback={null}>
          <RecentReels />
        </Suspense>
      }
      advertisingHref="/nalog?odjeljak=oglasi"
      creditsHref="/nalog?odjeljak=krediti"
      slots={{
        categories: (
          <Suspense fallback={<HomeCategories categories={[]} searchAction={href} />}>
            <HomeDirectoryCategories
              data={classification}
              place={place}
              href={href}
              sponsor={
                <Suspense fallback={null}>
                  <HomeAd data={campaigns} slot="icon" />
                </Suspense>
              }
            />
          </Suspense>
        ),
        featured: (
          <Suspense fallback={null}>
            <HomePromotedListings
              data={featured}
              example={example}
              classification={classification}
              title={titles.featured || "Istaknute djelatnosti"}
            />
          </Suspense>
        ),
        newest: (
          <Suspense fallback={null}>
            <HomeNewestListings
              data={newest}
              example={example}
              classification={classification}
              title={titles.newest || "Novi na AhiBizzu"}
            />
          </Suspense>
        ),
        nearby: (
          <Suspense fallback={<HomeNearbySection title={nearbyTitle} />}>
            <HomeLocalDirectory
              data={local}
              classification={classification}
              place={place}
              title={nearbyTitle}
            />
          </Suspense>
        ),
        floatingAd: (
          <Suspense fallback={null}>
            <HomeAd data={campaigns} slot="elsewhere" />
          </Suspense>
        ),
        inlineAd: (fallback) => (
          <Suspense fallback={fallback}>
            <HomeAd data={campaigns} slot="inline" fallback={fallback} />
          </Suspense>
        ),
      }}
    />
  );
}
