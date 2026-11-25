export type HomeCategory = {
  id: string;
  label: string;
  href: string;
  icon?: "heart" | "home" | "coffee" | "shop" | "bed" | "car";
};

/** A missing, duplicated or control-character location never becomes an active place. */
export function homePlace(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return "";
  return value.trim().slice(0, 100);
}

export function homeCategories(
  categories: readonly {
    id: string;
    name: string;
    parentId: string | null;
    accommodation?: boolean;
  }[],
  place = "",
): HomeCategory[] {
  return categories
    .filter((category) => category.parentId === null)
    .map((category) => ({
      id: category.id,
      label: category.name,
      href: `/pretraga?${new URLSearchParams({
        categoryId: category.id,
        ...(place ? { mjesto: place } : {}),
      })}`,
      icon: category.accommodation ? "bed" : categoryIcon(category.name),
    }));
}

/** The icon a category gets wherever it is shown: home tiles and the listing card. */
export function categoryIcon(name: string): NonNullable<HomeCategory["icon"]> {
  const label = name.toLocaleLowerCase("bs");
  if (/zdrav|ljepot/.test(label)) return "heart";
  if (/\bdom\b|namje[šs]taj|ure[đd]enje/.test(label)) return "home";
  if (/ugostitelj|restoran|kafi[ćc]|prehran|hran[ae]/.test(label)) return "coffee";
  if (/smje[šs]taj|apartman|hotel|no[ćc]enj/.test(label)) return "bed";
  if (/vozil|rent|automobil/.test(label)) return "car";
  return "shop";
}
