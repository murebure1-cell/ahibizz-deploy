export type HomeCategory = {
  id: string;
  label: string;
  href: string;
  icon?: "heart" | "home" | "coffee" | "shop";
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
  categories: readonly { id: string; name: string; parentId: string | null }[],
): HomeCategory[] {
  return categories
    .filter((category) => category.parentId === null)
    .map((category) => ({
      id: category.id,
      label: category.name,
      href: `/pretraga?${new URLSearchParams({ categoryId: category.id })}`,
      icon: categoryIcon(category.name),
    }));
}

function categoryIcon(name: string): HomeCategory["icon"] {
  const label = name.toLocaleLowerCase("bs");
  if (/zdrav|ljepot/.test(label)) return "heart";
  if (/\bdom\b|namje[šs]taj|ure[đd]enje/.test(label)) return "home";
  if (/ugostitelj|restoran|kafi[ćc]|prehran/.test(label)) return "coffee";
  return "shop";
}
