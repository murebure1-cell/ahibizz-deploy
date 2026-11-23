import { BusinessGlobe } from "../../../components/map/BusinessGlobe";
import styles from "../../../components/map/globe.module.css";
import { mapCities, mapPins } from "../../../lib/business-map";
import { getPublicDirectoryService } from "../../../server/directory/read-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa djelatnosti" };

export default async function MapPage() {
  const rows =
    (await getPublicDirectoryService()
      ?.mapPins()
      .catch(() => null)) ?? [];
  const pins = mapPins(rows);
  const cities = mapCities(pins);
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <h1>Mapa djelatnosti</h1>
      <p>
        {pins.length
          ? `${pins.length} djelatnosti na mapi. Odaberi grad ili dodirni oznaku.`
          : "Još nema djelatnosti s lokacijom na mapi."}
      </p>
      <BusinessGlobe pins={pins} cities={cities} />
    </main>
  );
}
