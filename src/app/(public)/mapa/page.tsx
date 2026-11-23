import { BusinessGlobe } from "../../../components/map/BusinessGlobe";
import styles from "../../../components/map/globe.module.css";
import { mapCountries, mapPins } from "../../../lib/business-map";
import { getPublicDirectoryService } from "../../../server/directory/read-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "AhiBizz mapa svijeta" };

export default async function MapPage() {
  const rows =
    (await getPublicDirectoryService()
      ?.mapPins()
      .catch(() => null)) ?? [];
  const pins = mapPins(rows);
  return (
    <main id="glavni-sadrzaj" data-fullscreen="true">
      <h1 className={styles.srOnly}>AhiBizz mapa svijeta</h1>
      <BusinessGlobe pins={pins} countries={mapCountries(pins)} />
    </main>
  );
}
