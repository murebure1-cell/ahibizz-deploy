export function readPlatformCreditsOnly(env: Record<string, string | undefined> = process.env) {
  return env.AHIBIZZ_PLATFORM_CREDITS_ONLY === "true";
}
