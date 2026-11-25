"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logoIntroBootstrap, logoIntroDuration, logoIntroStorageKey } from "../../lib/logo-intro";
import { useT } from "../i18n/LocaleProvider";
import styles from "./logo-intro.module.css";
import { logoLetters, logoSymbol, logoSymbolBody, logoSymbolHole } from "./logo-paths";

const letterClasses = [
  styles.letter0,
  styles.letter1,
  styles.letter2,
  styles.letter3,
  styles.letter4,
  styles.letter5,
  styles.letter6,
  styles.letter7,
];

/** It plays at most once per page load, also when the home page is left and opened again. */
let playedThisLoad = false;

/**
 * The opening animation of the home page: a gold coin becomes the round hole in the symbol,
 * then the name and the line "Naša mreža, naša snaga" appear. It is in the page from the
 * server, hidden, and the script beside it reveals it before the first paint on a device that
 * has not seen it. It covers the page for a few seconds, ends on its own or at a tap or a key,
 * and is decoration only: the page behind it is complete and stays readable to screen readers.
 */
export function LogoIntro() {
  const t = useT();
  const [gone, setGone] = useState(false);
  const [skip, setSkip] = useState(false);
  const started = useRef(false);
  const finish = useCallback(() => {
    delete document.documentElement.dataset.intro;
    setGone(true);
  }, []);

  useEffect(() => {
    // The decision is taken once per mount; React may run this effect twice in development.
    if (!started.current) {
      if (document.documentElement.dataset.intro !== "play" || playedThisLoad) {
        finish();
        return;
      }
      started.current = true;
      playedThisLoad = true;
      try {
        localStorage.setItem(logoIntroStorageKey, "1");
      } catch {
        // Without storage the bootstrap does not start the animation, so there is nothing to keep.
      }
    }
    const leave = () => setSkip(true);
    // A safety net: the page is never left covered if an animation event does not arrive.
    const timer = window.setTimeout(finish, logoIntroDuration + 600);
    window.addEventListener("keydown", leave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", leave);
    };
  }, [finish]);

  if (gone) return null;
  return (
    <>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Static first-party bootstrap with no user content.
        dangerouslySetInnerHTML={{ __html: logoIntroBootstrap }}
      />
      <div
        className={styles.intro}
        aria-hidden="true"
        data-skip={skip || undefined}
        onPointerDown={() => setSkip(true)}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) finish();
        }}
      >
        <svg className={styles.stage} viewBox="50 30 460 190" aria-hidden="true">
          <g className={styles.logo}>
            <g transform="translate(80 50) scale(0.6491) translate(-220.275 -220.851)">
              <ellipse
                className={styles.shadow}
                cx="300"
                cy="410.9"
                rx="22"
                ry="4.2"
                fill="currentColor"
              />
              <g className={styles.symbol}>
                <path
                  transform={logoSymbolBody.transform}
                  d={logoSymbolBody.d}
                  fill="currentColor"
                />
                {logoSymbol.slice(1).map((path) => (
                  <path
                    key={path.transform}
                    transform={path.transform}
                    d={path.d}
                    fill="currentColor"
                  />
                ))}
                <path
                  className={styles.hole}
                  transform={logoSymbolHole.transform}
                  d={logoSymbolHole.d}
                />
              </g>
              {logoLetters.map((path, index) => (
                <g key={path.transform} className={letterClasses[index]}>
                  <path transform={path.transform} d={path.d} fill="currentColor" />
                  {(index < 3 || index === 7) && (
                    <path className={styles.accent} transform={path.transform} d={path.d} />
                  )}
                </g>
              ))}
              <g className={styles.coinX}>
                <g className={styles.coinY}>
                  <g className={styles.coinSquash}>
                    <g className={styles.coinSpin}>
                      <circle cx="245.34" cy="288.81" r="13.3" fill="#e8c068" />
                      <circle
                        cx="245.34"
                        cy="288.81"
                        r="9.31"
                        fill="none"
                        stroke="#b8872b"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M238.94 286.61a7.4 7.4 0 0 1 5.6-5.4"
                        fill="none"
                        stroke="#fff1c4"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </svg>
        <p className={styles.tagline}>{t("Naša mreža, naša snaga")}.</p>
      </div>
    </>
  );
}
