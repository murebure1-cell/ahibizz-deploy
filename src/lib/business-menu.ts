/** A business's menu and the origin of its meat, as the owner states them (migration 0061). */
export type MenuItem = { name: string; priceCents: number | null };
export type MeatSource = { kind: string; supplier: string };
export type BusinessMenu = { items: MenuItem[]; meat: MeatSource[]; version: number };

export const menuLimits = { items: 60, meat: 12, name: 80, kind: 40, supplier: 80 } as const;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

/** Reads and normalises a menu; throws on anything that is not one. */
export function readBusinessMenu(value: unknown): Omit<BusinessMenu, "version"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MENU");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.items) || !Array.isArray(input.meat)) throw new Error("INVALID_MENU");
  if (input.items.length > menuLimits.items || input.meat.length > menuLimits.meat)
    throw new Error("INVALID_MENU");
  const items = input.items.map((raw) => {
    const row = raw as Record<string, unknown> | null;
    const name = text(row?.name, menuLimits.name);
    const price = row?.priceCents;
    if (
      !name ||
      !(
        price === null ||
        (Number.isSafeInteger(price) && (price as number) >= 0 && (price as number) <= 10_000_000)
      )
    )
      throw new Error("INVALID_MENU");
    return { name, priceCents: price as number | null };
  });
  const meat = input.meat.map((raw) => {
    const row = raw as Record<string, unknown> | null;
    const kind = text(row?.kind, menuLimits.kind);
    const supplier = text(row?.supplier, menuLimits.supplier);
    if (!kind || !supplier) throw new Error("INVALID_MENU");
    return { kind, supplier };
  });
  return { items, meat };
}

/** "7 KM", "16,50 KM". */
export function menuPrice(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${whole}${rest ? `,${String(rest).padStart(2, "0")}` : ""} KM`;
}

/** Parses what an owner types as a price: "7", "16,50", "16.5 KM"; empty is no price. */
export function parseMenuPrice(value: string): number | null | undefined {
  const cleaned = value.replace(/km/i, "").trim().replace(",", ".");
  if (!cleaned) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}
