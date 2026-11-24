"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import { rich } from "../i18n/Rich";
import { DevicePermissions } from "./AppPermissions";
import { useAppPwa } from "./AppPwa";
import styles from "./pwa.module.css";

export function InstallPage() {
  const t = useT();
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
          src="/app-icons/icon-192.png"
          width={76}
          height={76}
          alt=""
          unoptimized
        />
        <h1 id="install-title">{t("AhiBizz na telefonu.")}</h1>
        <p className={styles.intro}>{t("Direktno s tvog početnog ekrana.")}</p>
        {pwa.installed ? (
          <>
            <p className={styles.installed}>
              <Icon name="check" /> Već koristiš AhiBizz kao aplikaciju.
            </p>
            <DevicePermissions />
          </>
        ) : (
          <>
            {pwa.embedded && (
              <p className={styles.hint}>
                {t("Za instalaciju otvori ovaj link u Chromeu ili Safariju.")}
              </p>
            )}
            <button
              className={styles.install}
              type="button"
              disabled={pwa.prompting || pwa.accepted}
              onClick={() => void pwa.install()}
            >
              <Icon name="download" />
              {pwa.prompting
                ? t("Potvrdi u pregledniku")
                : pwa.accepted
                  ? t("Instalacija je pokrenuta")
                  : t("Instaliraj AhiBizz")}
            </button>
            <p className={styles.status} role="status">
              {pwa.note}
            </p>
            <div className={styles.instructions}>
              <details open={pwa.platform === "android"}>
                <summary>Android</summary>
                <ol>
                  <li>{t("Otvori ovu stranicu u Chromeu.")}</li>
                  <li>
                    {rich(t("U meniju {menu} odaberi {add} ili {install}."), {
                      menu: <strong>⋮</strong>,
                      add: <strong>{t("Dodaj na početni ekran")}</strong>,
                      install: <strong>{t("Instaliraj aplikaciju")}</strong>,
                    })}
                  </li>
                  <li>{t("Potvrdi instalaciju i otvori ikonu AhiBizz.")}</li>
                </ol>
              </details>
              <details open={pwa.platform === "ios"}>
                <summary>{t("iPhone i iPad")}</summary>
                <ol>
                  <li>{t("Otvori ovu stranicu u Safariju.")}</li>
                  <li>
                    {rich(t("Odaberi {action}."), {
                      action: <strong>{t("Dijeli → Dodaj na početni ekran")}</strong>,
                    })}
                  </li>
                  <li>
                    {rich(t("Ako se nudi, uključi {option}, pa odaberi {add}."), {
                      option: <strong>{t("Otvori kao web aplikaciju")}</strong>,
                      add: <strong>{t("Dodaj")}</strong>,
                    })}
                  </li>
                </ol>
              </details>
            </div>
            <button className={styles.copy} type="button" onClick={() => void copyLink()}>
              {copied ? t("Link je kopiran") : t("Kopiraj link za instalaciju")}
            </button>
            {manualLink && (
              <input
                className={styles.link}
                aria-label={t("Link za instalaciju")}
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
