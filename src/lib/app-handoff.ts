/**
 * Signing in to the native app through this website, Google included. The app opens
 * /nalog/aplikacija with a PKCE challenge (RFC 7636, S256) and a state of its own. Once the person
 * confirms there, the server mints a one-time code bound to that challenge and sends the browser to
 * the app's own address. Only the app that holds the matching verifier can turn the code into a
 * session; a code read anywhere else is useless.
 */
export const appHandoffPath = "/nalog/aplikacija";

/** The installed app's own address. The server never sends a code anywhere else. */
export const appReturnAddress = "ahibizz://povratak";

/** The installed app's package: the only one an intent: link is delivered to. */
export const appPackage = "com.ahibizz.app";

/** How long a code lives: enough to come back from the browser, not to linger. */
export const appHandoffSeconds = 120;

const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const statePattern = /^[A-Za-z0-9_-]{16,64}$/;
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9_-]{43,128}$/;

export type AppHandoff = { challenge: string; state: string };

/** BASE64URL(SHA-256) of a verifier: always 43 characters. */
export function appHandoffChallenge(value: unknown): value is string {
  return typeof value === "string" && challengePattern.test(value);
}

/** A code minted by the server: 32 random bytes in base64url. */
export function appHandoffCode(value: unknown): value is string {
  return typeof value === "string" && codePattern.test(value);
}

/** RFC 7636 allows 43 to 128 characters; the app sends base64url only. */
export function appHandoffVerifier(value: unknown): value is string {
  return typeof value === "string" && verifierPattern.test(value);
}

/**
 * The challenge and state from a page address or a form, each exactly once and nothing else
 * beside them except the named extra fields.
 */
export function readAppHandoff(
  params: URLSearchParams,
  extra: readonly string[] = [],
): AppHandoff | null {
  for (const key of params.keys())
    if (key !== "izazov" && key !== "stanje" && !extra.includes(key)) return null;
  const challenges = params.getAll("izazov");
  const states = params.getAll("stanje");
  if (challenges.length !== 1 || states.length !== 1) return null;
  const challenge = challenges[0] ?? "";
  const state = states[0] ?? "";
  return appHandoffChallenge(challenge) && statePattern.test(state) ? { challenge, state } : null;
}

/** The one written form of the confirmation page, so sign-in can return to it. */
export function appHandoffPagePath({ challenge, state }: AppHandoff): string {
  return `${appHandoffPath}?izazov=${challenge}&stanje=${state}`;
}

/**
 * Chrome on Android and the browsers built on it, but not a page embedded inside another app
 * (a WebView, marked "wv"), where the embedding app decides what a link does.
 */
function understandsIntentLinks(userAgent: string | null | undefined): boolean {
  return (
    typeof userAgent === "string" &&
    userAgent.includes("Android") &&
    userAgent.includes(" Chrome/") &&
    !userAgent.includes("; wv)")
  );
}

/**
 * Where the browser goes after confirming: the app, with its code and its own state.
 *
 * Any Android app can claim the ahibizz:// address. Chrome and the browsers built on it also
 * understand intent: links, which name the one package that may receive them, so there the link
 * is delivered to com.ahibizz.app and to nothing else. The app receives the same ahibizz://
 * address either way. Other browsers keep the plain address.
 */
export function appReturnLink(code: string, state: string, userAgent?: string | null): string {
  const query = `kod=${code}&stanje=${state}`;
  return understandsIntentLinks(userAgent)
    ? `intent://povratak?${query}#Intent;scheme=ahibizz;package=${appPackage};end`
    : `${appReturnAddress}?${query}`;
}

/** Only the canonical page address survives sign-in; anything else is not this page. */
export function appHandoffReturnPath(value: string): string | null {
  if (!value.startsWith(`${appHandoffPath}?`)) return null;
  const handoff = readAppHandoff(new URLSearchParams(value.slice(appHandoffPath.length + 1)));
  return handoff && appHandoffPagePath(handoff) === value ? value : null;
}
