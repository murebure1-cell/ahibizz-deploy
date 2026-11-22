import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AudienceNavigation } from "../components/account/AudienceNavigation";
import { AppProviders } from "../components/design/AppProviders";
import { appearanceBootstrap } from "../lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AhiBizz — lokalno počinje s ljudima", template: "%s | AhiBizz" },
  description: "Pronađi djelatnosti u blizini, dogovori termin i poveži se s ljudima na AhiBizzu.",
  robots: { index: false, follow: false },
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "AhiBizz", statusBarStyle: "default" },
  icons: {
    icon: "/app-icons/icon-192.png",
    apple: "/app-icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: "#142c40", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useValidLang: Bosnian content uses the valid BCP 47 language code bs, missing from this rule's registry.
    <html lang="bs" suppressHydrationWarning>
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Static first-party preference bootstrap contains no user content.
          dangerouslySetInnerHTML={{ __html: appearanceBootstrap }}
        />
      </head>
      <body>
        <a className="skip-link" href="#glavni-sadrzaj">
          Preskoči na sadržaj
        </a>
        <AppProviders>{children}</AppProviders>
        <AudienceNavigation />
      </body>
    </html>
  );
}
