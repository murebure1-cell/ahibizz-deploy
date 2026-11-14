import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PreviewPwaProvider } from "../../components/preview/PreviewPwa";
import { PreviewShell } from "../../components/preview/PreviewShell";
import { PreviewStateProvider } from "../../components/preview/PreviewState";
import "./preview.css";

export const viewport: Viewport = { themeColor: "#142d44", viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Novi izgled — pregled",
  robots: { index: false, follow: false },
  manifest: "/preview-app.webmanifest",
  appleWebApp: { capable: true, title: "AhiBizz", statusBarStyle: "default" },
  icons: {
    apple: "/preview-app/icons/apple-touch-icon.png",
    icon: "/preview-app/icons/icon-192.png",
  },
};

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <PreviewPwaProvider>
      <PreviewStateProvider>
        <div className="design-preview">
          <PreviewShell />
          {children}
        </div>
      </PreviewStateProvider>
    </PreviewPwaProvider>
  );
}
