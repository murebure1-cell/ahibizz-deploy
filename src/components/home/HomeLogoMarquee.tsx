"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "../Icon";
import styles from "./home.module.css";

export function HomeLogoMarquee() {
  const [paused, setPaused] = useState(false);
  return (
    <section className={styles.partners} aria-label="Poslovna mreža">
      <div className={`${styles.container} ${styles.partnersHeading}`}>
        <span>Mjesto za tvoju poslovnu mrežu.</span>
        <button
          type="button"
          aria-label={paused ? "Pokreni traku logotipa" : "Zaustavi traku logotipa"}
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          <Icon name={paused ? "play" : "pause"} />
        </button>
      </div>
      <div className={styles.logoTrack} data-paused={paused}>
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
