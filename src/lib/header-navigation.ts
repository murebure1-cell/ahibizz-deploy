import type { IconName } from "../components/Icon";
import { accountSectionPath } from "./account-return";
import type { HeaderAccess } from "./header-access";

export type NavigationDestination = { href: string; label: string; icon: IconName };

export function headerDestinations(
  access: HeaderAccess,
  options: { installed: boolean; playEdition: boolean; supportAvailable: boolean },
) {
  const primary: NavigationDestination[] = [
    { href: "/", label: "Početna", icon: "home" },
    { href: "/pretraga", label: "Pretraga", icon: "search" },
    { href: "/ljudi", label: "Ljudi", icon: "people" },
  ];
  if (access !== "guest") primary.push({ href: "/nalog", label: "Moj nalog", icon: "user" });
  if (access === "member" || access === "owner")
    primary.push({ href: accountSectionPath("messages"), label: "Poruke", icon: "message" });

  const business: NavigationDestination[] = options.playEdition
    ? []
    : [
        { href: "/oglasavanje", label: "Oglašavanje", icon: "star" },
        { href: "/paketi", label: "Paketi za djelatnosti", icon: "card" },
      ];
  const more: NavigationDestination[] = [{ href: "/o-nama", label: "O AhiBizzu", icon: "info" }];
  if (!options.playEdition && options.supportAvailable)
    more.push({ href: "/podrzi", label: "Podrži AhiBizz", icon: "heart" });
  if (!options.installed && !options.playEdition)
    more.push({ href: "/instaliraj", label: "Instaliraj aplikaciju", icon: "download" });
  more.push({ href: "/privatnost", label: "Privatnost", icon: "shield" });
  return { primary, business, more };
}

export function headerCurrentDestination(pathname: string, query: URLSearchParams): string {
  if (
    pathname === "/nalog" &&
    query.getAll("odjeljak").length === 1 &&
    query.get("odjeljak") === "poruke"
  )
    return accountSectionPath("messages");
  if (pathname.startsWith("/djelatnosti/")) return "/pretraga";
  if (pathname.startsWith("/ljudi/")) return "/ljudi";
  if (pathname.startsWith("/administracija/")) return "/administracija";
  if (pathname.startsWith("/paketi/")) return "/paketi";
  if (pathname === "/naplata" || pathname.startsWith("/naplata/")) return "/oglasavanje";
  return pathname;
}
