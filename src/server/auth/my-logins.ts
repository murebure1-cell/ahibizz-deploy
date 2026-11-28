import type { AuthService } from "./service";

/** One signed-in session of the current account, as the "Aktivne prijave" screen shows it. */
export type MySession = {
  id: string;
  device: string;
  browser: string;
  lastActive: string;
  current: boolean;
};

/** How the current account can sign in. */
export type MyLogins = { google: boolean; password: boolean };

export class MyLoginsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Sign-in settings could not be read or changed.");
    this.status = status;
    this.code = code;
  }
}

const sessionId = /^[A-Za-z0-9_-]{1,128}$/;

/** A short device and browser name from a user agent; never the address or full string. */
export function describeUserAgent(agent: unknown): { device: string; browser: string } {
  const ua = typeof agent === "string" ? agent : "";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  // The native app names itself ("AhiBizz/1.0.0 (Android)"), so its sign-in is told apart.
  const browser = /^AhiBizz\//.test(ua)
    ? "AhiBizz"
    : /Edg\//.test(ua)
      ? "Edge"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /OPR\/|Opera/.test(ua)
          ? "Opera"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "";
  return { device, browser };
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : 0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

async function current(auth: AuthService, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id || !session.session?.id) throw new MyLoginsError(401, "SIGNED_OUT");
  return session;
}

type RawSession = {
  id?: unknown;
  token?: unknown;
  userAgent?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
};

function time(value: unknown): number {
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value : "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * The account's live sessions, read on the server.
 *
 * Not through the sign-in library's own list endpoint. That one also hands out every session's
 * token, so it answers only within a day of signing in (its "fresh session" rule), and the screen
 * showed "nije dostupno" from the second day on. This list never leaves the server with a token,
 * and it has to work on a phone that signed in weeks ago.
 */
async function rawSessions(auth: AuthService, userId: string): Promise<RawSession[]> {
  const { internalAdapter } = await auth.$context;
  const list: RawSession[] = await internalAdapter.listSessions(userId, {
    onlyActiveSessions: true,
  });
  const now = Date.now();
  return (Array.isArray(list) ? list : []).filter((entry) => time(entry.expiresAt) > now);
}

/** The sessions of the signed-in account, newest first, without tokens. */
export async function listMySessions(auth: AuthService, headers: Headers): Promise<MySession[]> {
  const me = await current(auth, headers);
  return (await rawSessions(auth, me.user.id))
    .filter((entry) => typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id as string,
      ...describeUserAgent(entry.userAgent),
      lastActive: iso(entry.updatedAt ?? entry.createdAt),
      current: entry.id === me.session.id,
    }))
    .sort((a, b) =>
      a.current !== b.current ? (a.current ? -1 : 1) : b.lastActive.localeCompare(a.lastActive),
    );
}

/** Signs out one other session of the same account. The token is looked up here, on the server. */
export async function revokeMySession(auth: AuthService, headers: Headers, id: unknown) {
  if (typeof id !== "string" || !sessionId.test(id))
    throw new MyLoginsError(400, "INVALID_SESSION");
  const me = await current(auth, headers);
  if (id === me.session.id) throw new MyLoginsError(400, "CURRENT_SESSION");
  const entry = (await rawSessions(auth, me.user.id)).find((item) => item.id === id);
  if (!entry || typeof entry.token !== "string") throw new MyLoginsError(404, "SESSION_NOT_FOUND");
  await auth.api.revokeSession({ headers, body: { token: entry.token } });
}

/** Signs out every session of the account except this one. */
export async function revokeMyOtherSessions(auth: AuthService, headers: Headers) {
  await current(auth, headers);
  await auth.api.revokeOtherSessions({ headers });
}

type RawAccount = { id?: unknown; providerId?: unknown };

async function rawAccounts(auth: AuthService, headers: Headers): Promise<RawAccount[]> {
  await current(auth, headers);
  const list = await auth.api.listUserAccounts({ headers });
  return Array.isArray(list) ? (list as RawAccount[]) : [];
}

/** Which sign-in methods the account has. */
export async function readMyLogins(auth: AuthService, headers: Headers): Promise<MyLogins> {
  const providers = (await rawAccounts(auth, headers)).map((entry) => entry.providerId);
  return { google: providers.includes("google"), password: providers.includes("credential") };
}

/** Detaches Google. Allowed only while the account can still sign in with its password. */
export async function unlinkMyGoogle(auth: AuthService, headers: Headers) {
  const accounts = await rawAccounts(auth, headers);
  const google = accounts.find((entry) => entry.providerId === "google");
  if (!google || typeof google.id !== "string") throw new MyLoginsError(404, "GOOGLE_NOT_LINKED");
  if (!accounts.some((entry) => entry.providerId === "credential"))
    throw new MyLoginsError(409, "PASSWORD_REQUIRED");
  try {
    await auth.api.unlinkAccount({ headers, body: { accountId: google.id } });
  } catch (error) {
    // The sign-in library removes a way of signing in only within a day of signing in. The
    // screen says so, instead of "try later", which would never help.
    const body = error && typeof error === "object" && "body" in error ? error.body : null;
    if (body && typeof body === "object" && "code" in body && body.code === "SESSION_NOT_FRESH")
      throw new MyLoginsError(403, "SIGN_IN_AGAIN");
    throw error;
  }
}
