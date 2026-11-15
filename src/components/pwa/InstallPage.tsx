"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "../Icon";
import { useAppPwa } from "./AppPwa";
import styles from "./pwa.module.css";

export function InstallPage() {
  const pwa = useAppPwa();
  const [copied, setCopied] = useState(false);
  const [manualLink, setManualLink] = useState("");

  async function copyLink() {
    const link = new URL("/instaliraj", window.location.origin).href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setManualLink("");
    } catch {
      setManualLink(link);
    }
  }

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <section className={styles.card} aria-labelledby="install-title">
        <Image
          className={styles.icon}
          src="/preview-app/icons/icon-192.png"
          width={76}
          height={76}
          alt=""
          unoptimized
        />
        <h1 id="install-title">AhiBizz na telefonu.</h1>
        <p className={styles.intro}>Direktno s tvog početnog ekrana.</p>
        {pwa.installed ? (
          <p className={styles.installed}>
            <Icon name="check" /> Već koristiš AhiBizz kao aplikaciju.
          </p>
        ) : (
          <>
            {pwa.embedded && (
              <p className={styles.hint}>Za instalaciju otvori ovaj link u Chromeu ili Safariju.</p>
            )}
            <button
              className={styles.install}
              type="button"
              disabled={pwa.prompting || pwa.accepted}
              onClick={() => void pwa.install()}
            >
              <Icon name="download" />
              {pwa.prompting
                ? "Potvrdi u pregledniku"
                : pwa.accepted
                  ? "Instalacija je pokrenuta"
                  : "Instaliraj AhiBizz"}
            </button>
            <p className={styles.status} role="status">
              {pwa.note}
            </p>
            <div className={styles.instructions}>
              <details open={pwa.platform === "android"}>
                <summary>Android</summary>
                <ol>
                  <li>Otvori ovu stranicu u Chromeu.</li>
                  <li>
                    U meniju <strong>⋮</strong> odaberi <strong>Dodaj na početni ekran</strong> ili{" "}
                    <strong>Instaliraj aplikaciju</strong>.
                  </li>
                  <li>Potvrdi instalaciju i otvori ikonu AhiBizz.</li>
                </ol>
              </details>
              <details open={pwa.platform === "ios"}>
                <summary>iPhone i iPad</summary>
                <ol>
                  <li>Otvori ovu stranicu u Safariju.</li>
                  <li>
                    Odaberi <strong>Dijeli → Dodaj na početni ekran</strong>.
                  </li>
                  <li>
                    Ako se nudi, uključi <strong>Otvori kao web aplikaciju</strong>, pa odaberi{" "}
                    <strong>Dodaj</strong>.
                  </li>
                </ol>
              </details>
            </div>
            <button className={styles.copy} type="button" onClick={() => void copyLink()}>
              {copied ? "Link je kopiran" : "Kopiraj link za instalaciju"}
            </button>
            {manualLink && (
              <input
                className={styles.link}
                aria-label="Link za instalaciju"
                value={manualLink}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}
