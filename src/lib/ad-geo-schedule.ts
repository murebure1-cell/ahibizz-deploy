export type DailyAdWindow = { startMinute: number; endMinute: number; timeZone: string };
export const maxCampaignCities = 12;
export const campaignTimeZones = [
  ...new Set([
    "Europe/Sarajevo",
    "UTC",
    ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []),
  ]),
];
export function timeMinute(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function minuteTime(minute: number): string {
  return [Math.floor(minute / 60), minute % 60].map((n) => String(n).padStart(2, "0")).join(":");
}
export function campaignCities(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > maxCampaignCities) return null;
  const output: string[] = [],
    seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string" || /\p{Cc}/u.test(value)) return null;
    const city = value.trim().normalize("NFC");
    if (!city || city.length > 80) return null;
    const key = city.toLocaleLowerCase("bs");
    if (!seen.has(key)) {
      seen.add(key);
      output.push(city);
    }
  }
  return output;
}
