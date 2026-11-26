import type { Pool } from "pg";
import { type AccountRole, type AuthService, readCurrentAuthUser } from "./service";

/** One account signed in on this device, as the switcher shows it. Never carries a token. */
export type DeviceAccount = { id: string; name: string; role: AccountRole; active: boolean };

export class DeviceAccountError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("Device account action could not be completed.");
    this.status = status;
    this.code = code;
  }
}

const accountId = /^[A-Za-z0-9_-]{1,128}$/;

function setCookies(response: Response) {
  return response.headers.getSetCookie();
}

async function currentUserId(auth: AuthService, headers: Headers) {
  const current = await auth.api.getSession({ headers });
  if (!current?.user?.id) throw new DeviceAccountError(401, "SIGNED_OUT");
  return current.user.id;
}

/** Remembers the active session among the device's accounts; returns the cookies to send. */
async function rememberCurrent(auth: AuthService, headers: Headers) {
  const response = await auth.api.rememberDeviceSession({ headers, asResponse: true });
  return response.ok ? setCookies(response) : [];
}

async function deviceSessions(auth: AuthService, headers: Headers) {
  const list = await auth.api.listDeviceSessions({ headers });
  return Array.isArray(list) ? list : [];
}

/**
 * The accounts signed in on this device that may still be used: verified and approved, read
 * from the database now rather than from the session snapshot. The active one comes first.
 */
export async function listDeviceAccounts(auth: AuthService, pool: Pool, headers: Headers) {
  const active = await currentUserId(auth, headers);
  const cookies = await rememberCurrent(auth, headers);
  const ids = [active];
  for (const entry of await deviceSessions(auth, headers))
    if (typeof entry?.user?.id === "string" && !ids.includes(entry.user.id))
      ids.push(entry.user.id);
  const accounts: DeviceAccount[] = [];
  for (const id of ids) {
    const user = await readCurrentAuthUser(pool, id);
    if (!user?.emailVerified || user.approval !== "approved") continue;
    accounts.push({ id: user.id, name: user.name, role: user.role, active: id === active });
  }
  if (!accounts[0]?.active) throw new DeviceAccountError(401, "SIGNED_OUT");
  return { accounts, cookies };
}

/**
 * Makes another account on this device the active one. The current session is remembered first
 * so the person can switch back without signing in again.
 */
export async function switchDeviceAccount(
  auth: AuthService,
  pool: Pool,
  headers: Headers,
  target: unknown,
) {
  if (typeof target !== "string" || !accountId.test(target))
    throw new DeviceAccountError(400, "INVALID_ACCOUNT");
  const active = await currentUserId(auth, headers);
  const user = await readCurrentAuthUser(pool, target);
  if (!user?.emailVerified || user.approval !== "approved")
    throw new DeviceAccountError(403, "ACCOUNT_ACCESS_DENIED");
  if (target === active) return { role: user.role, cookies: [] as string[] };
  const entry = (await deviceSessions(auth, headers)).find((item) => item?.user?.id === target);
  if (!entry?.session?.token) throw new DeviceAccountError(404, "ACCOUNT_NOT_ON_DEVICE");
  const cookies = await rememberCurrent(auth, headers);
  const response = await auth.api.setActiveSession({
    body: { sessionToken: entry.session.token },
    headers,
    asResponse: true,
  });
  if (!response.ok) throw new DeviceAccountError(404, "ACCOUNT_NOT_ON_DEVICE");
  return { role: user.role, cookies: [...cookies, ...setCookies(response)] };
}
