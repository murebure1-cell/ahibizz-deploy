export const audienceRegions = {
  fbih: "Federacija BiH",
  rs: "Republika Srpska",
  brcko: "Brčko distrikt",
  abroad: "Izvan BiH",
} as const;
export type AudienceRegion = keyof typeof audienceRegions;
export type AudienceChoice = "off" | "general" | AudienceRegion;
export const audienceHint = "ahi-audience-account";
export function isAudienceChoice(value: unknown): value is AudienceChoice {
  return (
    typeof value === "string" &&
    (value === "off" || value === "general" || Object.hasOwn(audienceRegions, value))
  );
}
