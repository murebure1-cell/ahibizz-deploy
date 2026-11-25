import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "../components/design/AppProviders";
import { LocaleProvider } from "../components/i18n/LocaleProvider";
import { appearanceBootstrap } from "../lib/appearance";
import { isRtl } from "../lib/i18n/locales";
import { wwwAliasBootstrap } from "../lib/origin-alias";
import { configuredOrigin } from "../server/auth-availability";
import { getLocale, getTranslator } from "../server/i18n";
import "./globals.css";
import "./motion.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: { default: t("AhiBizz — lokalno počinje s ljudima"), template: "%s | AhiBizz" },
    description: t(
      "Pronađi djelatnosti u blizini, dogovori termin i poveži se s ljudima na AhiBizzu.",
    ),
    robots: { index: false, follow: false },
    manifest: "/app.webmanifest",
    appleWebApp: { capable: true, title: "AhiBizz", statusBarStyle: "default" },
    icons: {
      icon: "/app-icons/icon-192.png",
      apple: "/app-icons/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslator();
  const aliasBootstrap = wwwAliasBootstrap(configuredOrigin());
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} suppressHydrationWarning>
      <head>
        {aliasBootstrap && (
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Built only from the validated configured host; no user content.
            dangerouslySetInnerHTML={{ __html: aliasBootstrap }}
          />
        )}
        {/* The whole interface uses this face; without the preload the text would swap in late. */}
        <link
          rel="preload"
          href="/fonts/manrope-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/manrope-latin-ext.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Static first-party preference bootstrap contains no user content.
          dangerouslySetInnerHTML={{ __html: appearanceBootstrap }}
        />
      </head>
      <body>
        <a className="skip-link" href="#glavni-sadrzaj">
          {t("Preskoči na sadržaj")}
        </a>
        <LocaleProvider locale={locale}>
          <AppProviders>{children}</AppProviders>
        </LocaleProvider>
      </body>
    </html>
  );
}
