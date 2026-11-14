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
    .slice(0, 4)
    .map((category) => ({
      id: category.id,
      label: category.name,
      href: `/pretraga?${new URLSearchParams({ categoryId: category.id })}`,
      icon: "shop",
    }));
}
