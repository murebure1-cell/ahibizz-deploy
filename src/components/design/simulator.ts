import type { DesignScreen, VisualDesign } from "../../lib/visual-design";

export const screens = [
  ["home", "Početna"],
  ["search", "Pretraga"],
  ["business", "Djelatnost"],
  ["auth", "Prijava"],
  ["account", "Moj nalog"],
  ["profile", "Lični profil"],
  ["messages", "Poruke"],
  ["booking", "Termini"],
  ["admin", "Administracija"],
] as const satisfies readonly (readonly [Exclude<DesignScreen, "global">, string])[];

export type SimulatorScreen = (typeof screens)[number][0];
export function isScreen(screen: unknown): screen is SimulatorScreen {
  return screens.some(([id]) => id === screen);
}
export type FrameState = {
  design: VisualDesign;
  screen: SimulatorScreen;
  dark: boolean;
  inspect: boolean;
  selected: string;
};
export const frameChannel = "ahibizz-design-frame-v1";
export function screenForPath(url: URL): SimulatorScreen | null {
  const path = url.pathname;
  if (path === "/") return "home";
  if (path === "/pretraga") return "search";
  if (path.startsWith("/djelatnosti/")) return "business";
  if (path === "/prijava" || path === "/registracija") return "auth";
  if (path.startsWith("/ljudi")) return "profile";
  if (path === "/nalog")
    return url.searchParams.get("odjeljak") === "poruke"
      ? "messages"
      : url.searchParams.get("odjeljak") === "termini"
        ? "booking"
        : "account";
  if (path.startsWith("/poruke")) return "messages";
  if (path === "/administracija") return "admin";
  return null;
}
