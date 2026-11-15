export type Appearance = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export const appearanceStorageKey = "ahibizz.appearance.v1";

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveAppearance(value: Appearance, systemDark: boolean): ResolvedAppearance {
  return value === "system" ? (systemDark ? "dark" : "light") : value;
}

/** A display cache only. Signed account settings remain the source of truth. */
export const appearanceBootstrap = `(()=>{try{let v;try{v=localStorage.getItem("${appearanceStorageKey}")}catch{}const a=v==="light"||v==="dark"?v:"system";const t=a==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):a;document.documentElement.dataset.appearance=a;document.documentElement.dataset.theme=t}catch{}})();`;
