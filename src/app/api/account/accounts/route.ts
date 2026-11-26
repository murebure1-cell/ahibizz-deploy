import { readAuthConfiguration } from "../../../../server/auth/config";
import {
  DeviceAccountError,
  listDeviceAccounts,
  switchDeviceAccount,
} from "../../../../server/auth/device-accounts";
import { getAuthDatabasePool, getAuthService } from "../../../../server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

function failure(error: unknown) {
  return error instanceof DeviceAccountError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
}

/** The accounts signed in on this device ("Prebaci nalog"). */
export async function GET(request: Request) {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  try {
    const { accounts, cookies } = await listDeviceAccounts(auth, pool, request.headers);
    return reply({ accounts }, 200, cookies);
  } catch (error) {
    return failure(error);
  }
}

/** Switch to another account on this device: { "account": "<id>" }. */
export async function POST(request: Request) {
  const configuration = readAuthConfiguration(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!configuration || !auth || !pool) return reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
  if (request.headers.get("origin") !== new URL(configuration.baseURL).origin)
    return reply({ code: "INVALID_ORIGIN" }, 403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024) return reply({ code: "INVALID_REQUEST" }, 400);
    body = JSON.parse(text);
  } catch {
    return reply({ code: "INVALID_REQUEST" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "account")
  )
    return reply({ code: "UNEXPECTED_FIELD" }, 400);
  try {
    const { role, cookies } = await switchDeviceAccount(
      auth,
      pool,
      request.headers,
      (body as { account?: unknown }).account,
    );
    return reply({ ok: true, next: role === "owner" ? "/administracija" : "/nalog" }, 200, cookies);
  } catch (error) {
    return failure(error);
  }
}
