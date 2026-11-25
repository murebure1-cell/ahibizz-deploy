import Link from "next/link";
import { mapPins, mapPlaces } from "../../lib/business-map";
import { getPublicDirectoryService } from "../../server/directory/read-service";
import { getTranslator } from "../../server/i18n";
import { Icon } from "../Icon";
import { DotGlobe } from "./DotGlobe";
import styles from "./home-map-banner.module.css";

/** The places with a business, each about ten kilometres wide, with the number of businesses there. */
async function bannerLights() {
  const rows =
    (await getPublicDirectoryService()
      ?.mapPins()
      .catch(() => null)) ?? [];
  return mapPlaces(mapPins(rows)).map(({ latitude, longitude, count }) => ({
    latitude: Math.round(latitude * 10) / 10,
    longitude: Math.round(longitude * 10) / 10,
    count,
  }));
}

/** Home banner for the world map, as drawn: the card with its title and the globe rising out of it. */
export async function HomeMapBanner() {
  const [lights, t] = await Promise.all([bannerLights(), getTranslator()]);
  return (
    <section className={styles.banner} aria-labelledby="home-map-heading">
      <Link href="/mapa" className={styles.link} aria-labelledby="home-map-heading">
        <span className={styles.kicker}>{t("Naša mreža, naša snaga")}</span>
        <h2 id="home-map-heading">{t("AhiBizz mapa svijeta")}</h2>
        <span className={styles.cta}>
          {t("Otvori mapu")} <Icon name="chevron" />
        </span>
      </Link>
      <div className={styles.stage} aria-hidden="true">
        <DotGlobe lights={lights} step={6} />
      </div>
    </section>
  );
}
