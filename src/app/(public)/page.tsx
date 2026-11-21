import { DirectoryResultCard } from "../../components/directory/DirectoryResultCard";
import {
  HomeNearbyControl,
  HomeNearbyProvider,
  HomeNearbyResults,
} from "../../components/home/HomeNearby";
import { HomeSurface } from "../../components/home/HomeSurface";
import { RecentReels } from "../../components/reels/ReelShelf";
import { homeCategories, homePlace } from "../../lib/home";
import {
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../server/directory";
import { publicBusinessView } from "../../server/directory/public-view";
import { publicPageAds } from "../../server/marketing/ad-delivery";
import { readPublishedDesign } from "../../server/visual-design-store";

export const dynamic = "force-dynamic";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mjesto?: string | string[] }>;
}) {
  const [params, design] = await Promise.all([searchParams, readPublishedDesign()]);
  const place = homePlace(params.mjesto);
  const campaigns = publicPageAds({ page: "home", city: place });
  let available = false;
  let businesses: PublicDirectoryBusiness[] = [];
  let featured: PublicDirectoryBusiness[] = [];
  let inCategory: PublicDirectoryBusiness[] = [];
  let categories: DirectoryCategory[] = [];
  try {
    const service = getPublicDirectoryService();
    if (service) {
      const [classification, result, highlights, categoryHighlights] = await Promise.all([
        service.categories(),
        place ? service.listPublic({ city: place }) : Promise.resolve(null),
        service.listPublic({}, true),
        service.listPublic({}, "category"),
      ]);
      businesses = result?.items ?? [];
      featured = highlights.items.slice(0, 6);
      inCategory = categoryHighlights.items.slice(0, 6);
      categories = classification.categories;
      available = true;
    }
  } catch {
    /* An unavailable directory is distinct from a genuinely empty result. */
  }
  return (
    <HomeNearbyProvider
      key={place}
      categories={categories}
      initialBusinesses={businesses.map((business) => publicBusinessView(business, categories))}
      available={available}
      place={place}
    >
      <HomeSurface
        design={design}
        searchAction="/pretraga"
        placeField="mjesto"
        place={place}
        categories={homeCategories(categories, place)}
        discovery={<RecentReels />}
        featuredHref="/pretraga?istaknute=1"
        featured={
          featured.length
            ? featured.map((b) => (
                <DirectoryResultCard key={b.id} business={publicBusinessView(b, categories)} />
              ))
            : undefined
        }
        advertisingHref="/nalog?odjeljak=oglasi"
        categoryFeatured={inCategory.map((business) => (
          <DirectoryResultCard
            key={business.id}
            business={publicBusinessView(business, categories)}
          />
        ))}
        categoryAvailable={available}
        campaigns={await campaigns}
        creditsHref="/nalog?odjeljak=krediti"
        nearbyControl={<HomeNearbyControl />}
        nearby={<HomeNearbyResults />}
      />
    </HomeNearbyProvider>
  );
}
