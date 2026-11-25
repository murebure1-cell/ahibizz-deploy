"use client";

import { useEffect, useState } from "react";
import { menuPath } from "../../lib/app-menu";
import { type Locale, localeNames } from "../../lib/i18n/locales";
import { msg } from "../../lib/i18n/translate";
import { Icon } from "../Icon";
import { rowStyles, ScreenBar } from "../ui/Rows";
import { chooseLocale, chosenLocale, type LanguageChoice } from "./LanguagePicker";
import { useT } from "./LocaleProvider";
import styles from "./language-screen.module.css";

// The source language first, then the others in the order of the drawing.
const languages: { id: Locale; note: string }[] = [
  { id: "bs", note: msg("Zadani jezik") },
  { id: "ar", note: msg("Arapski · piše se zdesna nalijevo") },
  { id: "tr", note: msg("Turski") },
  { id: "en", note: msg("Engleski") },
  { id: "de", note: msg("Njemački") },
];

/** The language screen: one choice from a list, applied at once and kept on this device. */
export function LanguageScreen() {
  const t = useT();
  const [value, setValue] = useState<LanguageChoice | null>(null);
  useEffect(() => setValue(chosenLocale()), []);
  function option(id: LanguageChoice, mark: string | null, name: string, note: string) {
    return (
      <label key={id} className={styles.option}>
        <input
          type="radio"
          name="language"
          value={id}
          checked={value === id}
          disabled={value === null}
          onChange={() => {
            setValue(id);
            chooseLocale(id);
          }}
        />
        <span className={styles.code} aria-hidden="true">
          {mark ?? <Icon name="globe" />}
        </span>
        <span className={styles.text}>
          <span lang={id === "auto" ? undefined : id} dir={id === "ar" ? "rtl" : undefined}>
            {name}
          </span>
          <small>{note}</small>
        </span>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="check" />
        </span>
      </label>
    );
  }
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen} data-design="language-screen">
      <ScreenBar title={t("Jezik")} backHref={menuPath} backLabel={t("Nazad")} />
      <p className={rowStyles.lead}>
        {t(
          "Bira jezik aplikacije. Nazivi i opisi djelatnosti ostaju onako kako ih je vlasnik upisao.",
        )}
      </p>
      <fieldset className={styles.list}>
        <legend>{t("Jezik aplikacije")}</legend>
        {option("auto", null, t("Automatski"), t("Jezik uređaja"))}
        {languages.map(({ id, note }) =>
          option(id, id.toLocaleUpperCase("en"), localeNames[id], t(note)),
        )}
      </fieldset>
      <p className={rowStyles.lead}>
        {t(
          "Promjena važi odmah. Na arapskom se cijeli raspored okreće: nazad je desno, a lista ide zdesna nalijevo.",
        )}{" "}
        {t("Izbor se pamti samo na ovom uređaju.")}
      </p>
    </main>
  );
}
