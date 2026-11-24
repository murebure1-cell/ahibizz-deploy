import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { localeCookie, resolveLocale } from "../lib/i18n/locales";
import { translator } from "../lib/i18n/translate";

/** The visitor's interface language: a hand-picked one, otherwise the device language. */
export const getLocale = cache(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(localeCookie)?.value, headerStore.get("accept-language"));
});

export async function getTranslator() {
  return translator(await getLocale());
}

/** generateMetadata for a page whose title is fixed Bosnian text: export const generateMetadata = titled(text). */
export function titled(title: string, extra: Omit<Metadata, "title"> = {}) {
  return async (): Promise<Metadata> => ({ ...extra, title: (await getTranslator())(title) });
}
