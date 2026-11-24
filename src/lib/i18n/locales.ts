// Interface languages. Bosnian is the source language written in the code; the others come from
// the catalog. User content (descriptions, reviews, messages) is never translated.
export const locales = ["bs", "en", "de", "ar", "tr"] as const;
export type Locale = (typeof locales)[number];
export type TargetLocale = Exclude<Locale, "bs">;

export const sourceLocale: Locale = "bs";
// Shown when the device asks for a language AhiBizz does not have.
export const fallbackLocale: Locale = "en";
// Present only when someone chose a language by hand; otherwise the device language decides.
export const localeCookie = "ahibizz-lang";

export const localeNames: Record<Locale, string> = {
  bs: "Bosanski",
  en: "English",
  de: "Deutsch",
  ar: "العربية",
  tr: "Türkçe",
};

// Neighbouring languages read Bosnian without effort, so they get it instead of English.
const languageMap: Record<string, Locale> = {
  bs: "bs",
  hr: "bs",
  sr: "bs",
  sh: "bs",
  cnr: "bs",
  me: "bs",
  en: "en",
  de: "de",
  ar: "ar",
  tr: "tr",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function isRtl(locale: Locale) {
  return locale === "ar";
}

/** Picks the best interface language from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage?.trim()) return sourceLocale;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        tag: tag.trim().toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const match = languageMap[tag.split("-")[0] ?? ""];
    if (match) return match;
  }
  return fallbackLocale;
}

export function resolveLocale(chosen: string | null | undefined, acceptLanguage: string | null) {
  return isLocale(chosen) ? chosen : negotiateLocale(acceptLanguage);
}

/** BCP 47 tag for Intl date and number formatting. */
export const intlLocale: Record<Locale, string> = {
  bs: "bs-BA",
  en: "en-GB",
  de: "de-DE",
  ar: "ar",
  tr: "tr-TR",
};
