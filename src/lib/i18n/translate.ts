import { catalog } from "./catalog";
import type { Locale } from "./locales";

export type Vars = Record<string, string | number>;
export type Translate = (text: string, vars?: Vars) => string;

/**
 * Marks Bosnian text kept in data (menus, option lists) so the catalog check finds it.
 * The text is translated where it is shown, with t(text).
 */
export function msg<const T extends string>(text: T): T {
  return text;
}

const plurals = new Map<Locale, Intl.PluralRules>();

// {name} inserts a value; {count|one|other} picks a word by the language's plural rule.
function fill(locale: Locale, text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (whole, name: string, one, other) => {
    if (!(name in vars)) return whole;
    if (one === undefined) return String(vars[name]);
    let rules = plurals.get(locale);
    if (!rules) {
      rules = new Intl.PluralRules(locale);
      plurals.set(locale, rules);
    }
    return rules.select(Number(vars[name])) === "one" ? one : other;
  });
}

/**
 * Bosnian has three count forms (1 recenzija, 2 recenzije, 5 recenzija). Pick the Bosnian key
 * here; each translation then uses its own {count|…} plural.
 */
export function bosnianForm<T extends string>(count: number, one: T, few: T, other: T): T {
  const last = count % 10;
  const teen = count % 100;
  if (last === 1 && teen !== 11) return one;
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14)) return few;
  return other;
}

export function translate(locale: Locale, text: string, vars?: Vars) {
  if (locale === "bs") return fill(locale, text, vars);
  return fill(locale, catalog[text]?.[locale] ?? text, vars);
}

export function translator(locale: Locale): Translate {
  return (text, vars) => translate(locale, text, vars);
}
