import Link from "next/link";
import { mapPins } from "../../lib/business-map";
import { getPublicDirectoryService } from "../../server/directory/read-service";
import { getTranslator } from "../../server/i18n";
import { Icon } from "../Icon";
import { GoldGlobe } from "./GoldGlobe";
import styles from "./home-map-banner.module.css";

/** Approximate places (about 1 km) of every business on the map, without names, once per place. */
async function bannerPlaces(): Promise<[number, number][]> {
  const rows =
    (await getPublicDirectoryService()
      ?.mapPins()
      .catch(() => null)) ?? [];
  const places = new Map<string, [number, number]>();
  for (const pin of mapPins(rows)) {
    const place: [number, number] = [
      Math.round(pin.latitude * 100) / 100,
      Math.round(pin.longitude * 100) / 100,
    ];
    places.set(place.join(","), place);
  }
  return [...places.values()];
}

/** Home banner for the world map: title on the left, a turning blue-and-gold globe rising out of the card. */
export async function HomeMapBanner() {
  const [places, t] = await Promise.all([bannerPlaces(), getTranslator()]);
  return (
    <section className={styles.banner} aria-labelledby="home-map-heading">
      <Link href="/mapa" className={styles.link} aria-labelledby="home-map-heading">
        <span className={styles.text}>
          <span className={styles.kicker}>{t("Naša mreža, naša snaga")}</span>
          <h2 id="home-map-heading">{t("AhiBizz mapa svijeta")}</h2>
          <span className={styles.cta}>
            {t("Otvori mapu")} <Icon name="chevron" />
          </span>
        </span>
      </Link>
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.glow} />
        <GoldGlobe places={places} className={styles.globe} />
      </div>
    </section>
  );
}
