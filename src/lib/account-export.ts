import { msg } from "./i18n/translate";

/** The parts of "Preuzmi svoje podatke", as drawn, with the name used in the address. */
export const exportParts = [
  { id: "profile", query: "profil", label: msg("Profil i postavke"), preset: true },
  { id: "businesses", query: "djelatnosti", label: msg("Djelatnosti"), preset: true },
  { id: "messages", query: "poruke", label: msg("Poruke"), preset: true },
  { id: "bookings", query: "termini", label: msg("Termini i rezervacije"), preset: true },
  { id: "reviews", query: "recenzije", label: msg("Recenzije koje si napisao"), preset: true },
  { id: "reels", query: "reels", label: msg("Reels"), preset: false },
] as const;
export type ExportPart = (typeof exportParts)[number]["id"];
