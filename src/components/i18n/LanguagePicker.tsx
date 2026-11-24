"use client";

import { useEffect, useState } from "react";
import { isLocale, localeCookie, localeNames, locales } from "../../lib/i18n/locales";
import { useT } from "./LocaleProvider";

function chosenLocale() {
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${localeCookie}=`));
  const value = entry?.slice(localeCookie.length + 1);
  return isLocale(value) ? value : "auto";
}

// Most people never touch this: the device language decides. Choosing a language stores it in a
// cookie on this device only; "Automatski" removes the cookie again.
export function LanguagePicker({ className }: { className?: string }) {
  const t = useT();
  const [value, setValue] = useState("auto");
  useEffect(() => setValue(chosenLocale()), []);
  return (
    <label className={className ?? "language-picker"}>
      <span>{t("Jezik")}</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          const secure = window.location.protocol === "https:" ? "; Secure" : "";
          // biome-ignore lint/suspicious/noDocumentCookie: The Cookie Store API is missing in browsers this app supports; the value is one of our fixed locale codes.
          document.cookie =
            next === "auto"
              ? `${localeCookie}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
              : `${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
          window.location.reload();
        }}
      >
        <option value="auto">{t("Automatski (jezik uređaja)")}</option>
        {locales.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {localeNames[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
