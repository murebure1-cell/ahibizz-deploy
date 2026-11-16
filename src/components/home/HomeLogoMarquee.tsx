import Image from "next/image";
import styles from "./home.module.css";

export function HomeLogoMarquee() {
  return (
    <section className={styles.partners} aria-label="Poslovna mreža">
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
