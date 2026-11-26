import { bosnianForm, msg } from "../../lib/i18n/translate";
import type { StayUnit } from "../../lib/stays";

/** "2 noćenja": Bosnian counts in three forms, each translation in its own. */
export function nightsText(count: number) {
  return bosnianForm(count, msg("{count} noćenje"), msg("{count} noćenja"), msg("{count} noćenja"));
}

/** "4 kreveta". */
export function bedsText(count: number) {
  return bosnianForm(count, msg("{count} krevet"), msg("{count} kreveta"), msg("{count} kreveta"));
}

export const unitKinds: Record<StayUnit["type"], string> = {
  room: msg("Soba"),
  apartment: msg("Apartman"),
};
