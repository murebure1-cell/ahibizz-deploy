"use client";

import Image from "next/image";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Icon } from "../Icon";

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
const PwaContext = createContext<{
  installed: boolean;
  install: () => Promise<void>;
  note: string;
}>({ installed: false, install: async () => {}, note: "" });

export function PreviewPwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const check = () =>
      setInstalled(
        media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    check();
    media.addEventListener("change", check);
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    let registered: ServiceWorkerRegistration | undefined;
    const hadController = !!navigator.serviceWorker?.controller;
    let refreshing = false;
    const changed = () => {
      if (hadController && !refreshing) {
        refreshing = true;
        window.location.reload();
      }
    };
    const refresh = () => {
      if (document.visibilityState === "visible") registered?.update().catch(() => {});
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      navigator.serviceWorker
        .register("/preview-sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          registered = reg;
          return reg.update();
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", refresh);
    return () => {
      media.removeEventListener("change", check);
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
      document.removeEventListener("visibilitychange", refresh);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);
  async function install() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome !== "accepted")
        setNote("Instalaciju možeš pokrenuti ponovo iz menija preglednika.");
      return;
    }
    setNote(
      /iPhone|iPad|iPod/.test(navigator.userAgent)
        ? "U Safariju otvori Dijeli → Dodaj na početni zaslon."
        : "U Chromeu otvori meni ⋮ → Dodaj na početni ekran → Instaliraj.",
    );
  }
  return <PwaContext.Provider value={{ installed, install, note }}>{children}</PwaContext.Provider>;
}

export function PreviewInstall({ standalone = false }: { standalone?: boolean }) {
  const pwa = useContext(PwaContext);
  if (pwa.installed && !standalone) return null;
  return (
    <section
      className={`preview-install${standalone ? " preview-install-page" : " preview-container"}`}
      aria-labelledby="install-title"
    >
      <Image src="/preview-app/icons/icon-192.png" width={62} height={62} alt="" unoptimized />
      <div>
        <span className="preview-kicker">AHIBIZZ NA TELEFONU</span>
        <h2 id="install-title">Uvijek pri ruci.</h2>
        <p>Instaliraj pregled i prati novi izgled.</p>
      </div>
      <button
        className="preview-button"
        type="button"
        onClick={() => void pwa.install()}
        disabled={pwa.installed}
      >
        <Icon name="download" />
        {pwa.installed ? "Aplikacija je instalirana" : "Instaliraj AhiBizz"}
      </button>
      <p className="preview-install-note" role="status">
        {pwa.note}
      </p>
    </section>
  );
}
