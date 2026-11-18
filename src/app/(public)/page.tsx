import {
  HomeNearbyControl,
  HomeNearbyProvider,
  HomeNearbyResults,
} from "../../components/home/HomeNearby";
import { HomeEmptyState, HomeSurface } from "../../components/home/HomeSurface";
import { homeCategories, homePlace } from "../../lib/home";
import {
  type DirectoryCategory,
  getPublicDirectoryService,
  type PublicDirectoryBusiness,
} from "../../server/directory";
import { publicBusinessView } from "../../server/directory/public-view";

export const dynamic = "force-dynamic";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mjesto?: string | string[] }>;
}) {
  const params = await searchParams;
  const place = homePlace(params.mjesto);
  let available = false;
  let businesses: PublicDirectoryBusiness[] = [];
  let categories: DirectoryCategory[] = [];
  try {
    const service = getPublicDirectoryService();
    if (service) {
      const [classification, result] = await Promise.all([
        service.categories(),
        place ? service.listPublic({ city: place }) : Promise.resolve(null),
      ]);
      businesses = result?.items.slice(0, 5) ?? [];
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
        searchAction="/pretraga"
        placeField="mjesto"
        place={place}
        categories={homeCategories(categories)}
        featuredHref="/pretraga"
        featured={<HomeEmptyState>Isticanje je u pripremi.</HomeEmptyState>}
        advertisingHref="mailto:info@ahibizz.com?subject=Ogla%C5%A1avanje%20na%20AhiBizzu"
        nearbyControl={<HomeNearbyControl />}
        nearby={<HomeNearbyResults />}
      />
    </HomeNearbyProvider>
  );
}
