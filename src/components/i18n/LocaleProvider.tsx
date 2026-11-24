"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { type Translate, translator } from "../../lib/i18n/translate";

const LocaleContext = createContext<{ locale: Locale; t: Translate }>({
  locale: "bs",
  t: translator("bs"),
});

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: translator(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext).locale;
}

export function useT() {
  return useContext(LocaleContext).t;
}
