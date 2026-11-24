import { BusinessGlobe } from "../../../components/map/BusinessGlobe";
import styles from "../../../components/map/globe.module.css";
import { mapCountries, mapPins } from "../../../lib/business-map";
import { getPublicDirectoryService } from "../../../server/directory/read-service";
import { getTranslator, titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("AhiBizz mapa svijeta");

export default async function MapPage() {
  const t = await getTranslator();
  const rows =
    (await getPublicDirectoryService()
      ?.mapPins()
      .catch(() => null)) ?? [];
  const pins = mapPins(rows);
  return (
    <main id="glavni-sadrzaj" data-fullscreen="true">
      <h1 className={styles.srOnly}>{t("AhiBizz mapa svijeta")}</h1>
      <BusinessGlobe pins={pins} countries={mapCountries(pins)} />
    </main>
  );
}
