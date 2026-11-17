"use client";

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { AppPermissionPrompt } from "./AppPermissions";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type Platform = "ios" | "android" | "other";
type PwaState = {
  installed: boolean;
  accepted: boolean;
  prompting: boolean;
  canPrompt: boolean;
  platform: Platform;
  embedded: boolean;
  note: string;
  install: () => Promise<void>;
};

const PwaContext = createContext<PwaState | null>(null);

export function AppPwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [embedded, setEmbedded] = useState(false);
  const [note, setNote] = useState("");
  const deferred = useRef<InstallPrompt | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const agent = navigator.userAgent;
    const ios =
      /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
    setPlatform(ios ? "ios" : /Android/.test(agent) ? "android" : "other");
    setEmbedded(/FBAN|FBAV|Instagram|\bLine\/|; wv\)/i.test(agent));
    const media = window.matchMedia("(display-mode: standalone)");
    const check = () => {
      const standalone =
        media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setInstalled(standalone);
      if (standalone) document.documentElement.dataset.appDisplay = "standalone";
      else delete document.documentElement.dataset.appDisplay;
    };
    check();
    media.addEventListener("change", check);
    const ready = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallPrompt;
      setCanPrompt(true);
      setAccepted(false);
      setNote("");
    };
    const done = () => {
      deferred.current = null;
      setCanPrompt(false);
      setAccepted(true);
      setNote(
        "Instalacija je pokrenuta. Dovrši je u pregledniku, pa otvori AhiBizz s početnog ekrana.",
      );
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    let registration: ServiceWorkerRegistration | undefined;
    const update = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((value) => {
          registration = value;
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", update);
    return () => {
      media.removeEventListener("change", check);
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
      document.removeEventListener("visibilitychange", update);
      delete document.documentElement.dataset.appDisplay;
    };
  }, []);

  async function install() {
    if (installed || accepted || busy.current) return;
    const event = deferred.current;
    if (!event) {
      setNote(
        platform === "ios"
          ? "Otvori meni Dijeli → Dodaj na početni ekran. Ako opcija nedostaje, otvori ovu stranicu u Safariju."
          : "U Chromeu otvori meni ⋮ → Dodaj na početni ekran → Instaliraj aplikaciju.",
      );
      return;
    }
    deferred.current = null;
    setCanPrompt(false);
    busy.current = true;
    setPrompting(true);
    try {
      // Keep prompt() in this click's user activation; each event is used only once.
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") {
        setAccepted(true);
        setNote(
          "Instalacija je pokrenuta. Dovrši je u pregledniku, pa otvori AhiBizz s početnog ekrana.",
        );
      } else {
        setNote("Instalaciju možeš kasnije pokrenuti iz menija preglednika.");
      }
    } catch {
      setNote("Pokreni instalaciju kroz meni preglednika ili prati upute ispod.");
    } finally {
      busy.current = false;
      setPrompting(false);
    }
  }

  return (
    <PwaContext.Provider
      value={{ installed, accepted, prompting, canPrompt, platform, embedded, note, install }}
    >
      {children}
      <AppPermissionPrompt />
    </PwaContext.Provider>
  );
}

export function useAppPwa() {
  const context = useContext(PwaContext);
  if (!context) throw new Error("PWA provider is missing");
  return context;
}
