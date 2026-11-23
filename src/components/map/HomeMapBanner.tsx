import Link from "next/link";
import { Icon } from "../Icon";
import styles from "./home-map-banner.module.css";

const meridians = [0, 30, 60, 90, 120, 150];
const parallels = [
  { y: -34, size: 0.8 },
  { y: 0, size: 1 },
  { y: 34, size: 0.8 },
];

/** Home banner for the world map: title on the left, a slowly turning globe rising out of the card. */
export function HomeMapBanner() {
  return (
    <section className={styles.banner} aria-labelledby="home-map-heading">
      <Link href="/mapa" className={styles.link} aria-labelledby="home-map-heading">
        <span className={styles.text}>
          <span className={styles.kicker}>Naša mreža, naša snaga</span>
          <h2 id="home-map-heading">AhiBizz mapa svijeta</h2>
          <span className={styles.cta}>
            Otvori mapu <Icon name="chevron" />
          </span>
        </span>
      </Link>
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.glow} />
        <div className={styles.sphere} />
        <div className={styles.spin}>
          {meridians.map((angle) => (
            <span
              key={angle}
              className={styles.meridian}
              style={{ transform: `rotateY(${angle}deg)` }}
            />
          ))}
          {parallels.map((ring) => (
            <span
              key={ring.y}
              className={styles.parallel}
              style={{ transform: `translateY(${ring.y}%) rotateX(90deg) scale(${ring.size})` }}
            />
          ))}
        </div>
        <span className={`${styles.dot} ${styles.dotOne}`} />
        <span className={`${styles.dot} ${styles.dotTwo}`} />
        <span className={`${styles.dot} ${styles.dotThree}`} />
      </div>
    </section>
  );
}
