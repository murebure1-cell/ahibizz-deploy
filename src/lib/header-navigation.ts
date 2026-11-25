import type { IconName } from "../components/Icon";
import { accountSectionPath } from "./account-return";
import type { HeaderAccess } from "./header-access";
import { msg } from "./i18n/translate";

export type NavigationDestination = { href: string; label: string; icon: IconName };

export function headerDestinations(
  access: HeaderAccess,
  options: { installed: boolean; playEdition: boolean; supportAvailable: boolean },
) {
  const primary: NavigationDestination[] = [
    { href: "/", label: msg("Početna"), icon: "home" },
    { href: "/pretraga", label: msg("Pretraga"), icon: "search" },
    { href: "/ljudi", label: msg("Ljudi"), icon: "people" },
  ];
  if (access !== "guest") primary.push({ href: "/nalog", label: msg("Moj nalog"), icon: "user" });
  if (access === "member" || access === "owner")
    primary.push({ href: accountSectionPath("messages"), label: msg("Poruke"), icon: "message" });

  const business: NavigationDestination[] = [];
  const more: NavigationDestination[] = [
    { href: "/o-nama", label: msg("O AhiBizzu"), icon: "info" },
    { href: "/reels", label: msg("Reels"), icon: "play" },
    { href: "/blog", label: msg("AhiBizz blog"), icon: "info" },
    { href: "/pomoc", label: msg("Centar za pomoć"), icon: "message" },
  ];
  if (!options.playEdition && options.supportAvailable)
    more.push({ href: "/podrzi", label: msg("Doniraj"), icon: "heart" });
  if (!options.installed && !options.playEdition)
    more.push({ href: "/instaliraj", label: msg("Instaliraj aplikaciju"), icon: "download" });
  more.push({ href: "/privatnost", label: msg("Privatnost"), icon: "shield" });
  return { primary, business, more };
}

export function headerCurrentDestination(pathname: string, query: URLSearchParams): string {
  if (
    pathname === "/nalog" &&
    query.getAll("odjeljak").length === 1 &&
    query.get("odjeljak") === "poruke"
  )
    return accountSectionPath("messages");
  if (pathname === "/nalog") {
    const section = query.getAll("odjeljak");
    if (section.length === 1) {
      const selected = section[0];
      const view = query.get("prikaz");
      if (selected === "termini" && view === "historija")
        return "/nalog?odjeljak=termini&prikaz=historija";
      if (selected === "djelatnosti" && query.get("novo") === "1")
        return "/nalog?odjeljak=djelatnosti&novo=1";
      if (
        selected &&
        ["termini", "djelatnosti", "sacuvani", "profil", "postavke"].includes(selected)
      )
        return `/nalog?odjeljak=${selected}`;
    }
  }
  if (pathname === "/blog" && query.get("sacuvano") === "1") return "/blog?sacuvano=1";
  if (pathname.startsWith("/blog/")) return "/blog";
  if (pathname.startsWith("/reels/")) return "/reels";
  if (pathname.startsWith("/djelatnosti/")) return "/pretraga";
  if (pathname.startsWith("/ljudi/")) return "/ljudi";
  if (pathname.startsWith("/administracija/")) return "/administracija";
  return pathname;
}
