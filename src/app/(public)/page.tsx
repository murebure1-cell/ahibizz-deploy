import Form from "next/form";
import { DirectoryResultCard } from "../../components/directory/DirectoryResultCard";
import { HomeEmptyState, HomeSurface } from "../../components/home/HomeSurface";
import homeStyles from "../../components/home/home.module.css";
import { Icon } from "../../components/Icon";
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
      businesses = result?.items.slice(0, 4) ?? [];
      categories = classification.categories;
      available = true;
    }
  } catch {
    /* An unavailable directory is distinct from a genuinely empty result. */
  }
  return (
    <HomeSurface
      searchAction="/pretraga"
      placeField="mjesto"
      place={place}
      categories={homeCategories(categories)}
      featuredHref="/pretraga"
      featured={<HomeEmptyState>Isticanje je u pripremi.</HomeEmptyState>}
      advertisingHref="mailto:info@ahibizz.com?subject=Ogla%C5%A1avanje%20na%20AhiBizzu"
      nearbyControl={
        <Form action="/" className={homeStyles.placeForm}>
          <label htmlFor="home-place" className={homeStyles.srOnly}>
            Grad ili mjesto
          </label>
          <input
            id="home-place"
            name="mjesto"
            placeholder="Grad ili mjesto"
            defaultValue={place}
            maxLength={100}
          />
          <button type="submit" aria-label="Prikaži djelatnosti u ovom mjestu">
            <Icon name="search" />
          </button>
        </Form>
      }
      nearby={
        !available ? (
          <HomeEmptyState>Imenik trenutno nije dostupan.</HomeEmptyState>
        ) : !place ? (
          <HomeEmptyState icon="pin">Odaberi grad za prikaz djelatnosti.</HomeEmptyState>
        ) : businesses.length ? (
          businesses.map((business) => (
            <DirectoryResultCard
              key={business.id}
              business={publicBusinessView(business, categories)}
            />
          ))
        ) : (
          <HomeEmptyState>Još nema objavljenih djelatnosti za {place}.</HomeEmptyState>
        )
      }
    />
  );
}
