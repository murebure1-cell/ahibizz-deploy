import type { IconName } from "../components/Icon";
import { accountNotificationsPath, accountSectionPath } from "./account-return";
import { msg } from "./i18n/translate";

/**
 * The menu screen: everything that is not one of the five places in the dock. It is one list for
 * a guest, a member and the owner, so a place is added here once and is reachable by all who may
 * open it.
 */
export type AppMenuAccess = "guest" | "member" | "owner";
export type AppMenuRow = {
  label: string;
  icon: IconName;
  /** Missing for a function that is announced but not built yet: the row says "Uskoro". */
  href?: string;
};
export type AppMenuGroup = { id: string; title: string; rows: AppMenuRow[] };

export const menuPath = "/meni";
export const languagePath = "/jezik";

export function appMenuGroups(
  access: AppMenuAccess,
  options: { installed: boolean; playEdition: boolean; supportAvailable: boolean },
): AppMenuGroup[] {
  const signedIn = access !== "guest";
  const language: AppMenuRow = { label: msg("Jezik"), icon: "globe", href: languagePath };
  const groups: AppMenuGroup[] = [];
  groups.push(
    signedIn
      ? {
          id: "account",
          title: msg("Nalog"),
          rows: [
            { label: msg("Postavke"), icon: "sliders", href: accountSectionPath("settings") },
            language,
            { label: msg("Obavijesti"), icon: "bell", href: accountNotificationsPath },
            { label: msg("Sačuvano"), icon: "heart", href: accountSectionPath("saved") },
            { label: msg("Bedževi"), icon: "star" },
          ],
        }
      : { id: "app", title: msg("Aplikacija"), rows: [language] },
  );
  groups.push({
    id: "ahibizz",
    title: "AhiBizz",
    rows: [
      { label: msg("Mapa svijeta"), icon: "pin", href: "/mapa" },
      { label: msg("Ljudi"), icon: "people", href: "/ljudi" },
      { label: msg("Reels"), icon: "play", href: "/reels" },
      { label: msg("Blog"), icon: "doc", href: "/blog" },
      { label: msg("Ahi zajednica"), icon: "people" },
      { label: msg("Ahi investment"), icon: "chart" },
    ],
  });
  if (access === "owner")
    groups.push({
      id: "admin",
      title: msg("Administracija"),
      rows: [
        { label: msg("Upravljanje platformom"), icon: "shield", href: "/administracija" },
        { label: msg("Odvojena administracija"), icon: "swap", href: "/administracija/odvojena" },
      ],
    });
  const help: AppMenuRow[] = [
    { label: msg("Pomoć i česta pitanja"), icon: "help", href: "/pomoc" },
    { label: msg("Kontakt"), icon: "mail", href: "/pomoc#kontakt" },
    { label: msg("O nama"), icon: "info", href: "/o-nama" },
    { label: msg("Pravilnik"), icon: "book", href: "/pravila-zajednice" },
    { label: msg("Pravila privatnosti"), icon: "lock", href: "/privatnost" },
  ];
  if (!options.playEdition && options.supportAvailable)
    help.push({ label: msg("Doniraj"), icon: "heart", href: "/podrzi" });
  if (!options.installed && !options.playEdition)
    help.push({ label: msg("Instaliraj aplikaciju"), icon: "download", href: "/instaliraj" });
  groups.push({ id: "help", title: msg("Pomoć i pravila"), rows: help });
  if (signedIn)
    groups.push({
      id: "delete",
      title: msg("Brisanje"),
      rows: [
        {
          label: msg("Brisanje djelatnosti"),
          icon: "shop",
          href: accountSectionPath("businesses"),
        },
        { label: msg("Brisanje profila"), icon: "trash", href: "/brisanje-naloga" },
      ],
    });
  return groups;
}
