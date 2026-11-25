import { type ReactNode, Suspense } from "react";
import { LogoIntro } from "../../components/brand/LogoIntro";
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
import { HomeMapBanner } from "../../components/map/HomeMapBanner";
import { RecentReels } from "../../components/reels/ReelShelf";
import { homeCategories, homePlace } from "../../lib/home";
import { msg, type Translate } from "../../lib/i18n/translate";
import {
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../server/directory";
import { publicBusinessView } from "../../server/directory/public-view";
import { getTranslator } from "../../server/i18n";
import { readPublishedDesign } from "../../server/visual-design-store";

type Categories = Promise<DirectoryCategory[] | null>;
type Listings = Promise<PublicDirectoryBusiness[] | null>;

async function HomeDirectoryCategories({
  data,
  place,
  sponsor,
  t,
}: {
  data: Categories;
  place: string;
  sponsor: ReactNode;
  t: Translate;
}) {
  return (
    <HomeCategories
      t={t}
      categories={homeCategories((await data) ?? [], place)}
      sponsor={sponsor}
    />
  );
}

async function HomeNewestListings({
  data,
  example,
  classification,
  title,
  t,
}: {
  data: Listings;
  example: Promise<PublicDirectoryBusiness | null>;
  classification: Categories;
  title: string;
  t: Translate;
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
    <HomeListingsSection kind="newest" title={title} t={t}>
      <HomeBusinessRail label={title} cards={cards} />
    </HomeListingsSection>
  );
}

async function HomePromotedListings({
  data,
  classification,
  title,
  t,
}: {
  data: Promise<{ items: PublicDirectoryBusiness[]; pageSize: number; hasMore: boolean } | null>;
  classification: Categories;
  title: string;
  t: Translate;
}) {
  const [businesses, categories] = await Promise.all([data, classification]);
  if (!businesses?.items.length) return null;
  return (
    <HomeListingsSection
      kind="featured"
      title={title}
      t={t}
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
        example={null}
      />
    </HomeListingsSection>
  );
}

async function HomeLocalDirectory({
  data,
  classification,
  place,
  title,
  mapLabel,
}: {
  data: Listings;
  classification: Categories;
  place: string;
  title: string;
  mapLabel: string;
}) {
  const [businesses, categories] = await Promise.all([data, classification]);
  return (
    <>
      <HomeNearbyProvider
        key={place}
        categories={categories ?? []}
        initialBusinesses={(businesses ?? []).map((business) =>
          publicBusinessView(business, categories ?? []),
        )}
        available={place ? businesses !== null : categories !== null}
        place={place}
      >
        <HomeNearbySection title={title} mapLabel={mapLabel} control={<HomeNearbyControl />}>
          <HomeNearbyResults exampleId={homeExampleId} />
        </HomeNearbySection>
      </HomeNearbyProvider>
      <HomeMapBanner />
    </>
  );
}

export const dynamic = "force-dynamic";
const homeExampleId = "d0914355-b85e-40cd-b570-95eea243dc26";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mjesto?: string | string[] }>;
}) {
  const [params, design, t] = await Promise.all([
    searchParams,
    readPublishedDesign(),
    getTranslator(),
  ]);
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
  const featured = service?.homeAllPromotions().catch(() => null) ?? Promise.resolve(null);
  const newest = service?.homeNewest().catch(() => null) ?? Promise.resolve(null);
  const example = service?.readPublic(homeExampleId).catch(() => null) ?? Promise.resolve(null);
  const titles = design.sectionTitles ?? {};
  const nearbyTitle = t(titles.nearby || msg("Djelatnosti u blizini"));
  return (
    <>
      <LogoIntro />
      <HomeSurface
        t={t}
        design={design}
        searchAction="/pretraga"
        placeField="mjesto"
        place={place}
        discovery={
          <Suspense fallback={null}>
            <RecentReels />
          </Suspense>
        }
        slots={{
          categories: (
            <Suspense fallback={<HomeCategories t={t} categories={[]} />}>
              <HomeDirectoryCategories data={classification} place={place} sponsor={null} t={t} />
            </Suspense>
          ),
          featured: (
            <Suspense fallback={null}>
              <HomePromotedListings
                data={featured}
                classification={classification}
                title={t(titles.featured || msg("Istaknute djelatnosti"))}
                t={t}
              />
            </Suspense>
          ),
          newest: (
            <Suspense fallback={null}>
              <HomeNewestListings
                data={newest}
                example={example}
                classification={classification}
                title={t(titles.newest || msg("Novi na AhiBizzu"))}
                t={t}
              />
            </Suspense>
          ),
          nearby: (
            <Suspense fallback={<HomeNearbySection title={nearbyTitle} mapLabel={t("Karta")} />}>
              <HomeLocalDirectory
                data={local}
                classification={classification}
                place={place}
                title={nearbyTitle}
                mapLabel={t("Karta")}
              />
            </Suspense>
          ),
        }}
      />
    </>
  );
}
