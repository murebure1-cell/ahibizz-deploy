import { Suspense } from "react";
import { WorldMap } from "../../../components/map/WorldMap";
import styles from "../../../components/map/world-map.module.css";
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
      <Suspense>
        <WorldMap pins={pins} countries={mapCountries(pins)} />
      </Suspense>
    </main>
  );
}
