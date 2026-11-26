"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { countdownParts, dayWord, hourWord, openingWhen } from "../../lib/opening";
import { AhiLogo } from "../brand/AhiLogo";
import { logoSymbol, logoSymbolBody } from "../brand/logo-paths";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./under-construction.module.css";

/** The round hole in the corner of the symbol, in the logo's own units: its centre and radius. */
const hole = { x: 245.34, y: 288.81, r: 13.3 };

/**
 * The symbol with the loading light running along its edge, and the gold coin practising its
 * jump into the hole: two small hops, the jump, a moment in its place, and back down. It stays
 * there on the day of opening.
 */
function PreparingMark({ label }: { label: string }) {
  return (
    <svg className={styles.mark} viewBox="197 240 174 184" role="img" aria-label={label}>
      {logoSymbol.map((path) => (
        <path key={path.transform} transform={path.transform} d={path.d} fill="currentColor" />
      ))}
      <path
        className={`${styles.beam} ${styles.glow}`}
        pathLength={1}
        transform={logoSymbolBody.transform}
        d={logoSymbolBody.d}
        strokeWidth={8}
      />
      <path
        className={styles.beam}
        pathLength={1}
        transform={logoSymbolBody.transform}
        d={logoSymbolBody.d}
        strokeWidth={3}
      />
      <path className={styles.ground} d="M219.34 417.04H271.34" />
      <g className={styles.coin}>
        <g className={styles.squash}>
          <circle cx={hole.x} cy={hole.y} r={hole.r} fill="#e8c068" />
          <circle cx={hole.x} cy={hole.y} r="9.31" fill="none" stroke="#b8872b" strokeWidth="1.5" />
          <path
            d="M238.94 286.61a7.4 7.4 0 0 1 5.6-5.4"
            fill="none"
            stroke="#fff1c4"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </g>
      </g>
    </svg>
  );
}

function two(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * "Uskoro otvaramo": what a visitor without an account sees until the app opens. The logo, the
 * symbol being prepared, a line of text, the time left in four tiles and the day of opening,
 * with the way in for people who have an account.
 */
export function UnderConstruction({
  opensAt,
  now,
  from,
}: {
  /** The moment of opening, in milliseconds. */
  opensAt: number;
  /** The server's clock when it drew the page; the count follows it, not the device's. */
  now: number;
  /** Where the visitor was going, to return there after signing in. */
  from: string | null;
}) {
  const { t, locale } = useI18n();
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((opensAt - now) / 1000)));
  useEffect(() => {
    // A device's clock may be wrong; the difference to the server's is measured once.
    const ahead = now - Date.now();
    let timer = 0;
    const tick = () => {
      const seconds = Math.ceil((opensAt - (Date.now() + ahead)) / 1000);
      setLeft(Math.max(0, seconds));
      if (seconds > 0) return;
      // The day has come: this address now leads on to where the visitor was going.
      window.clearInterval(timer);
      window.location.reload();
    };
    timer = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(timer);
  }, [opensAt, now]);

  const parts = countdownParts(left);
  const tiles = [
    { key: "days", value: parts.days, label: t(dayWord(parts.days), { count: parts.days }) },
    { key: "hours", value: parts.hours, label: t(hourWord(parts.hours), { count: parts.hours }) },
    { key: "minutes", value: parts.minutes, label: t("min") },
    { key: "seconds", value: parts.seconds, label: t("sek") },
  ];
  const signIn = from ? `/prijava?${new URLSearchParams({ nastavi: from })}` : "/prijava";

  return (
    <div className={styles.screen}>
      <AhiLogo className={styles.logo} />
      <div className={styles.stage}>
        <PreparingMark label={t("AhiBizz se priprema")} />
      </div>
      <span className={styles.pill}>{t("U izradi")}</span>
      <h1>{t("Uskoro otvaramo")}</h1>
      <p className={styles.lead}>{t("Sređujemo zadnje detalje, da te sve dočeka kako treba.")}</p>
      <div className={styles.countdown} role="timer" aria-label={t("Vrijeme do otvaranja")}>
        {tiles.map((tile) => (
          <span className={styles.tile} key={tile.key}>
            {/* A new number rises into place; the key replays that for each change. */}
            <span className={styles.number}>
              <span key={tile.value} data-tick={tile.key === "seconds" || undefined}>
                {two(tile.value)}
              </span>
            </span>
            <span className={styles.unit}>{tile.label}</span>
          </span>
        ))}
      </div>
      <p className={styles.when}>{t("Otvaramo {when}", { when: openingWhen(opensAt, locale) })}</p>
      <span className={styles.space} />
      <p className={styles.tagline}>{t("Naša mreža, naša snaga")}.</p>
      <Link className={styles.signIn} href={signIn} prefetch={false}>
        {t("Imaš nalog? Prijavi se")}
      </Link>
    </div>
  );
}
