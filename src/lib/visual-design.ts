export type DesignVariant = "base" | "mobile" | "dark" | "mobileDark";
export const homeCoverPhotos = {
  community: { label: "Poslovna zajednica", src: "/images/business-community.webp" },
  studio: { label: "Studio", src: "/preview/studio.webp" },
  service: { label: "Servis", src: "/preview/service.webp" },
  home: { label: "Uređenje doma", src: "/preview/home.webp" },
  cafe: { label: "Ugostiteljstvo", src: "/preview/cafe.webp" },
} as const;
type HomeCoverPhotoId = keyof typeof homeCoverPhotos;
export function homeCoverId(value: unknown): HomeCoverPhotoId {
  if (value === undefined) return "community";
  if (typeof value === "string" && Object.hasOwn(homeCoverPhotos, value))
    return value as HomeCoverPhotoId;
  return invalid();
}
export type VisualDesign = {
  rules: Record<string, Partial<Record<DesignVariant, Record<string, string>>>>;
  homeOrder: string[];
  heroTitle: string;
  heroImage?: HomeCoverPhotoId;
  heroSubtitle?: string;
  sectionTitles?: Record<string, string>;
};

export type DesignScreen =
  | "global"
  | "home"
  | "search"
  | "business"
  | "account"
  | "messages"
  | "booking"
  | "admin"
  | "profile"
  | "auth";
type DesignTarget = { id: string; label: string; selector: string; screen: DesignScreen };
function target(id: string, label: string, screen: DesignScreen): DesignTarget {
  return { id, label, screen, selector: `[data-design="${id}"]` };
}
// Scope editor picking to main content. Published scopes below also account for component CSS.
const contentTargets: readonly DesignTarget[] = [
  { id: "app-page", label: "Pozadina stranice", screen: "global", selector: ":where(main)" },
  {
    id: "app-headings",
    label: "Naslovi stranice",
    screen: "global",
    selector: ":where(main) :is(h1,h2,h3,h4,h5,h6)",
  },
  {
    id: "app-copy",
    label: "Tekst i opisi",
    screen: "global",
    selector: ":where(main) :is(p,blockquote,figcaption,dd)",
  },
  {
    id: "app-labels",
    label: "Nazivi polja",
    screen: "global",
    selector: ":where(main) :is(label,legend)",
  },
  {
    id: "app-fields",
    label: "Polja za unos i odabir",
    screen: "global",
    selector:
      ':where(main) :is(textarea,select,input:where(:not([type="hidden"],[type="button"],[type="submit"],[type="reset"],[type="image"],[type="file"],[type="checkbox"],[type="radio"],[type="range"],[type="color"])))',
  },
  {
    id: "app-buttons",
    label: "Dugmad u sadržaju",
    screen: "global",
    selector:
      ':where(main) :is(button,a:where(.button,[role="button"]),input:where([type="button"],[type="submit"],[type="reset"]))',
  },
  {
    id: "app-links",
    label: "Tekstualni linkovi",
    screen: "global",
    selector: ':where(main) a:where([href]:not(.button,[role="button"]))',
  },
];
export const designTargets: readonly DesignTarget[] = [
  ...contentTargets,
  target("app-header", "Zaglavlje aplikacije", "global"),
  target("app-menu", "Glavni meni", "global"),
  target("home-hero", "Naslovni baner", "home"),
  target("home-title", "Glavni naslov", "home"),
  target("home-search", "Brza pretraga", "home"),
  target("home-categories", "Traka kategorija", "home"),
  target("home-featured", "Istaknute djelatnosti", "home"),
  target("home-promotion", "Poziv na isticanje", "home"),
  target("home-ad", "Oglas", "home"),
  target("home-reels", "Reels djelatnosti", "home"),
  target("home-newest", "Novi na AhiBizzu", "home"),
  target("home-nearby", "Djelatnosti u blizini", "home"),
  target("home-logos", "Traka logotipa", "home"),
  target("directory-card", "Kartica djelatnosti", "search"),
  target("search-form", "Pretraga i filteri", "search"),
  target("business-profile", "Poslovni profil", "business"),
  target("account-panel", "Korisnički panel", "account"),
  target("account-summary", "Zaglavlje pregleda naloga", "account"),
  target("account-metric", "Pločice pregleda naloga", "account"),
  target("messages-panel", "Poruke", "messages"),
  target("booking-panel", "Termini", "booking"),
  target("admin-panel", "Administracija", "admin"),
  target("personal-profile", "Lični profil", "profile"),
  target("auth-form", "Prijava i registracija", "auth"),
  target("app-toggle", "Dugme menija", "global"),
  target("app-menu-item", "Stavke menija", "global"),
  target("home-category", "Pločica kategorije", "home"),
  target("home-search-submit", "Dugme za pretragu", "home"),
  target("directory-title", "Naziv djelatnosti na kartici", "search"),
  target("directory-actions", "Akcije na kartici", "search"),
  target("business-cover", "Naslovnica djelatnosti", "business"),
  target("personal-name", "Ime na profilu", "profile"),
  target("auth-submit", "Dugme za prijavu", "auth"),
  target("admin-heading", "Naslov administracije", "admin"),
  target("message-composer", "Polje za poruku", "messages"),
  target("booking-time", "Dostupni termin", "booking"),
  target("account-sidebar", "Meni naloga", "account"),
  target("home-photo", "Fotografija naslovnog banera", "home"),
  target("directory-photo", "Fotografija kartice", "search"),
  target("business-photo", "Fotografija poslovne naslovnice", "business"),
];
// Read and preserve older saved designs without offering retired sections in the editor.
const retiredHomeTargetIds = [
  "home-credits",
  "home-category-featured",
  "home-local-featured",
  "home-community",
];

/** Inspect the closest editable element; an explicit name on that element wins. */
export function findDesignTarget(element: Element, boundary: Element) {
  if (!boundary.contains(element)) return null;
  for (let node: Element | null = element; node && node !== boundary; node = node.parentElement) {
    const id = node.getAttribute("data-design");
    const named =
      id && designTargets.find((item) => item.id === id && !contentTargets.includes(item));
    const chosen = named || contentTargets.find((item) => node?.matches(item.selector));
    if (chosen) return { target: chosen, element: node };
  }
  return null;
}

export const homeSections = [
  { id: "ad", label: "Oglasni prostor" },
  { id: "reels", label: "Reels djelatnosti" },
  { id: "newest", label: "Novi na AhiBizzu" },
  { id: "nearby", label: "Djelatnosti u blizini" },
  { id: "promotion", label: "Poziv na isticanje" },
  { id: "logos", label: "Poslovna mreža" },
  { id: "featured", label: "Sve istaknute djelatnosti" },
] as const;
const originalHomeSections = ["featured", "ad", "nearby", "logos", "credits"];
const retiredHomeSections = ["categoryFeatured", "community", "credits"];
const previousHomeSections = [
  ...new Set([...originalHomeSections, "promotion", ...retiredHomeSections]),
];

export type DesignProperty = {
  name: string;
  label: string;
  kind: "color" | "length" | "weight" | "choice";
  min?: number;
  max?: number;
  unit?: "px";
  options?: readonly string[];
};
export const designProperties: readonly DesignProperty[] = [
  { name: "color", label: "Boja teksta", kind: "color" },
  { name: "background-color", label: "Boja pozadine", kind: "color" },
  { name: "border-color", label: "Boja obruba", kind: "color" },
  { name: "border-width", label: "Debljina obruba", kind: "length", min: 0, max: 8, unit: "px" },
  { name: "border-radius", label: "Zaobljenje", kind: "length", min: 0, max: 56, unit: "px" },
  {
    name: "padding-block",
    label: "Unutrašnji razmak po visini",
    kind: "length",
    min: 0,
    max: 80,
    unit: "px",
  },
  {
    name: "padding-inline",
    label: "Unutrašnji razmak sa strana",
    kind: "length",
    min: 0,
    max: 48,
    unit: "px",
  },
  { name: "font-size", label: "Veličina slova", kind: "length", min: 12, max: 72, unit: "px" },
  {
    name: "padding-top",
    label: "Unutrašnji razmak gore",
    kind: "length",
    min: 0,
    max: 80,
    unit: "px",
  },
  {
    name: "padding-right",
    label: "Unutrašnji razmak desno",
    kind: "length",
    min: 0,
    max: 48,
    unit: "px",
  },
  {
    name: "padding-bottom",
    label: "Unutrašnji razmak dole",
    kind: "length",
    min: 0,
    max: 80,
    unit: "px",
  },
  {
    name: "padding-left",
    label: "Unutrašnji razmak lijevo",
    kind: "length",
    min: 0,
    max: 48,
    unit: "px",
  },
  { name: "margin-top", label: "Vanjski razmak gore", kind: "length", min: 0, max: 80, unit: "px" },
  {
    name: "margin-right",
    label: "Vanjski razmak desno",
    kind: "length",
    min: 0,
    max: 40,
    unit: "px",
  },
  {
    name: "margin-bottom",
    label: "Vanjski razmak dole",
    kind: "length",
    min: 0,
    max: 80,
    unit: "px",
  },
  {
    name: "margin-left",
    label: "Vanjski razmak lijevo",
    kind: "length",
    min: 0,
    max: 40,
    unit: "px",
  },
  { name: "gap", label: "Razmak elemenata", kind: "length", min: 0, max: 40, unit: "px" },
  {
    name: "text-align",
    label: "Poravnanje teksta",
    kind: "choice",
    options: ["start", "center", "end"],
  },
  {
    name: "font-family",
    label: "Font",
    kind: "choice",
    options: [
      "system-ui, sans-serif",
      "Arial, sans-serif",
      "Georgia, serif",
      "ui-monospace, monospace",
    ],
  },
  { name: "object-fit", label: "Prikaz slike", kind: "choice", options: ["cover", "contain"] },
  {
    name: "object-position",
    label: "Položaj slike",
    kind: "choice",
    options: [
      "center",
      "top",
      "right",
      "bottom",
      "left",
      "top left",
      "top right",
      "bottom left",
      "bottom right",
    ],
  },
  {
    name: "font-weight",
    label: "Debljina slova",
    kind: "weight",
    options: ["400", "500", "600", "650", "700", "750", "800"],
  },
  {
    name: "box-shadow",
    label: "Sjena",
    kind: "choice",
    options: ["none", "0 2px 8px #10273d14", "0 8px 24px #10273d26", "0 14px 40px #10273d33"],
  },
  {
    name: "backdrop-filter",
    label: "Zamućenje pozadine",
    kind: "choice",
    options: ["none", "blur(3px)", "blur(8px)", "blur(14px)"],
  },
];
const variants: readonly DesignVariant[] = ["base", "mobile", "dark", "mobileDark"];

export function defaultVisualDesign(): VisualDesign {
  return {
    rules: {},
    homeOrder: homeSections.map(({ id }) => id),
    heroTitle: "Pronađi pravu\nuslugu.",
    heroImage: "community",
    heroSubtitle: "",
    sectionTitles: {},
  };
}

function invalid(): never {
  throw new Error("INVALID_VISUAL_DESIGN");
}
function object(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    !Object.keys(input).every((key) => allowedKeys.includes(key))
  )
    invalid();
  return input as Record<string, unknown>;
}
function plainText(input: unknown, max: number, lines: number, required = false): string {
  if (
    typeof input !== "string" ||
    input.length > max ||
    input.split("\n").length > lines ||
    [...input].some((c) => (c.charCodeAt(0) < 32 && c !== "\n") || c.charCodeAt(0) === 127) ||
    /[<>]/.test(input) ||
    (required && !input.trim())
  )
    invalid();
  return input.trim();
}
function cssValue(def: DesignProperty, input: unknown): string {
  if (typeof input !== "string" || input.trim() !== input) return invalid();
  if (def.kind === "color") {
    const color =
      def.name === "background-color" ? /^#[a-f\d]{6}(?:[a-f\d]{2})?$/i : /^#[a-f\d]{6}$/i;
    if (!color.test(input)) return invalid();
    return input.toLowerCase();
  }
  if (def.kind === "length") {
    const match = /^(0|[1-9]\d?)px$/.exec(input);
    if (!match || Number(match[1]) < (def.min ?? 0) || Number(match[1]) > (def.max ?? 0))
      return invalid();
  } else if (!def.options?.includes(input)) return invalid();
  return input;
}
export function parseVisualDesign(input: unknown): VisualDesign {
  const value = object(input, [
    "rules",
    "homeOrder",
    "heroTitle",
    "heroImage",
    "heroSubtitle",
    "sectionTitles",
  ]);
  const ids: readonly string[] = homeSections.map(({ id }) => id);
  const order = value.homeOrder;
  if (!Array.isArray(order) || new Set(order).size !== order.length) invalid();
  const matches = (list: readonly unknown[], sections: readonly string[]) =>
    list.length === sections.length &&
    list.every((id) => typeof id === "string" && sections.includes(id));
  // A published order from before a section was retired keeps its arrangement without it.
  const kept = order.filter((id) => !retiredHomeSections.includes(id));
  const currentOrder = matches(kept, ids);
  if (
    !currentOrder &&
    !matches(order, previousHomeSections) &&
    !matches(order, originalHomeSections)
  )
    invalid();
  const design: VisualDesign = {
    rules: {},
    homeOrder: currentOrder ? [...kept] : [...ids],
    heroTitle: plainText(value.heroTitle, 100, 3, true),
    heroImage: homeCoverId(value.heroImage),
    heroSubtitle: plainText(value.heroSubtitle === undefined ? "" : value.heroSubtitle, 160, 2),
    sectionTitles: {},
  };
  const titles = object(value.sectionTitles === undefined ? {} : value.sectionTitles, [
    ...ids,
    ...retiredHomeSections,
  ]);
  const sectionTitles: Record<string, string> = {};
  for (const [id, title] of Object.entries(titles)) {
    if (!ids.includes(id)) continue;
    const normalized = plainText(title, 75, 2);
    if (normalized) sectionTitles[id] = normalized;
  }
  design.sectionTitles = sectionTitles;
  const targets = object(value.rules, [
    ...designTargets.map(({ id }) => id),
    ...retiredHomeTargetIds,
  ]);
  for (const [id, scopes] of Object.entries(targets)) {
    const scoped = object(scopes, variants);
    for (const variant of variants) {
      if (!Object.hasOwn(scoped, variant)) continue;
      const props = object(
        scoped[variant],
        designProperties.map(({ name }) => name),
      );
      const declarations: Record<string, string> = {};
      for (const prop of designProperties) {
        if (Object.hasOwn(props, prop.name))
          declarations[prop.name] = cssValue(prop, props[prop.name]);
      }
      if (Object.keys(declarations).length) {
        design.rules[id] ??= {};
        design.rules[id][variant] = declarations;
      }
    }
  }
  return design;
}
export function designCss(design: VisualDesign): string {
  const safe = parseVisualDesign(design);
  const result: string[] = [];
  const hasContentStyles = contentTargets.some((target) => safe.rules[target.id]);
  const contentScope = "body main:not([hidden])";
  for (const variant of variants) {
    const isDark = variant === "dark" || variant === "mobileDark";
    const rules: string[] = [];
    for (const item of designTargets) {
      const declarations = safe.rules[item.id]?.[variant];
      if (!declarations) continue;
      const css = Object.entries(declarations)
        .map(([name, value]) => `${name}:${value}`)
        .join(";");
      const contentTarget = contentTargets.includes(item);
      const dark = contentTarget ? ':where([data-theme="dark"])' : '[data-theme="dark"]';
      // Global fields override the component defaults without using !important.
      // A named target has an extra attribute of specificity, even across theme variants.
      let scope = item.selector;
      if (contentTarget) scope = scope.replace(":where(main)", contentScope);
      else if (hasContentStyles) scope = `:is(${scope},${contentScope} ${scope})`;
      const selector = `:root${isDark ? dark : ""} ${scope}`;
      const border = declarations["border-width"] ? ";border-style:solid" : "";
      const bg = declarations["background-color"];
      const rail =
        bg &&
        ["home-categories", "home-featured", "home-nearby", "home-newest", "home-reels"].includes(
          item.id,
        )
          ? `;--rail-surface:${bg}`
          : "";
      const cardSurface = bg && item.id === "directory-card" ? `;--ui-surface:${bg}` : "";
      rules.push(`${selector}{${css}${border}${rail}${cardSurface}}`);
      if (bg && item.id === "home-hero")
        rules.push(
          `${selector}::before{background:linear-gradient(90deg,color-mix(in srgb,${bg} 92%,transparent),color-mix(in srgb,${bg} 42%,transparent))}`,
        );
      if (declarations["backdrop-filter"]?.startsWith("blur(")) {
        rules.push(`@media(prefers-reduced-motion:reduce){${selector}{backdrop-filter:none}}`);
      }
    }
    if (!rules.length) continue;
    const css = rules.join("\n");
    result.push(
      variant === "mobile" || variant === "mobileDark" ? `@media(max-width:760px){${css}}` : css,
    );
  }
  return result.join("\n");
}
