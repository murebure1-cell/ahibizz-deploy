import Image from "next/image";
import { type Translate, translator } from "../../lib/i18n/translate";
import styles from "./home.module.css";

export function HomeLogoMarquee({
  title,
  t = translator("bs"),
}: {
  title?: string;
  t?: Translate;
}) {
  return (
    <section
      className={styles.partners}
      aria-label={title || t("Poslovna mreža")}
      data-design="home-logos"
    >
      {title && <h2 className={`${styles.container} ${styles.partnerTitle}`}>{title}</h2>}
      <div className={styles.logoTrack}>
        {[0, 1].map((copy) => (
          <div className={styles.logoGroup} key={copy} aria-hidden={copy === 1 ? true : undefined}>
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <Image
                key={item}
                src="/brand/ahi-logo-color.svg"
                alt={copy === 0 && item === 0 ? "AhiBizz" : ""}
                width={142}
                height={40}
                unoptimized
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
