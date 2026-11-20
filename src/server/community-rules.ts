import type { Pool } from "pg";
import { COMMUNITY_RULES_VERSION } from "../lib/community-rules";
import { IS_PLAY_EDITION } from "../lib/distribution";
import { AccountAccessError, accountTransaction, createAccountAccess } from "./auth/accounts";
import { readAuthConfiguration } from "./auth/config";
import { type AuthService, getAuthDatabasePool, getAuthService } from "./auth/service";

export function createCommunityRulesService(auth: AuthService, pool: Pool) {
  const access = createAccountAccess(auth);
  return async (headers: Headers, accept = false) => {
    const current = await access.session(headers);
    return accountTransaction(pool, async (client) => {
      const actor = await access.authority(client, current);
      if (accept) {
        await client.query(
          "INSERT INTO community_rules_acceptance(account_id,rules_version) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [actor.id, COMMUNITY_RULES_VERSION],
        );
        return { accepted: true, version: COMMUNITY_RULES_VERSION };
      }
      const result = await client.query(
        "SELECT 1 FROM community_rules_acceptance WHERE account_id=$1 AND rules_version=$2",
        [actor.id, COMMUNITY_RULES_VERSION],
      );
      return { accepted: result.rowCount === 1, version: COMMUNITY_RULES_VERSION };
    });
  };
}

function service() {
  const auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!auth || !pool) throw new AccountAccessError(503, "ACCOUNT_UNAVAILABLE");
  return createCommunityRulesService(auth, pool);
}

function reply(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  if (error instanceof AccountAccessError) return reply({ code: error.code }, error.status);
  return reply({ code: "COMMUNITY_RULES_UNAVAILABLE" }, 503);
}

function originAllowed(request: Request, origin: string | undefined) {
  return origin !== undefined && new URL(origin).origin === request.headers.get("origin");
}

type RulesService = ReturnType<typeof createCommunityRulesService>;

export async function communityRulesRequest(
  request: Request,
  origin: string | undefined,
  rules: RulesService,
) {
  try {
    if (!request.headers.get("X-AhiBizz-Account-ID"))
      return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
    if (request.method === "POST") {
      if (!originAllowed(request, origin)) return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.body !== null ||
        request.headers.get("X-AhiBizz-Community-Rules") !== COMMUNITY_RULES_VERSION
      ) {
        return reply({ code: "RULES_VERSION_CHANGED" }, 409);
      }
      return reply(await rules(request.headers, true), 200);
    }
    if (request.method !== "GET") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
    return reply(await rules(request.headers), 200);
  } catch (error) {
    return failure(error);
  }
}

export async function contributionPermission(
  request: Request,
  origin: string | undefined,
  rules: RulesService,
): Promise<Response | null> {
  try {
    if (!originAllowed(request, origin)) return reply({ code: "INVALID_ORIGIN" }, 403);
    if (!request.headers.get("X-AhiBizz-Account-ID"))
      return reply({ code: "ACCOUNT_IDENTITY_CHANGED" }, 401);
    const result = await rules(request.headers);
    return result.accepted
      ? null
      : reply({ code: "COMMUNITY_RULES_REQUIRED", rules: "/pravila-zajednice" }, 428);
  } catch (error) {
    return failure(error);
  }
}

export async function handleCommunityRules(request: Request) {
  if (!IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    return await communityRulesRequest(request, readAuthConfiguration()?.baseURL, service());
  } catch (error) {
    return failure(error);
  }
}

export async function checkContribution(request: Request): Promise<Response | null> {
  if (!IS_PLAY_EDITION) return null;
  try {
    return await contributionPermission(request, readAuthConfiguration()?.baseURL, service());
  } catch (error) {
    return failure(error);
  }
}

// POST is used for several safety and housekeeping operations as well as user contributions.
export function isContribution(method: string, pathname: string) {
  if (["PATCH", "PUT"].includes(method)) {
    return /^\/api\/(?:people\/me(?:\/|$)|business-details\/mine\/|business-media\/mine\/|reviews\/businesses\/[^/]+\/own$|directory\/mine\/|booking\/mine\/businesses\/[^/]+\/settings$)/i.test(
      pathname,
    );
  }
  return (
    method === "POST" &&
    /^\/api\/(?:messaging\/threads\/[^/]+\/messages|directory\/mine(?:\/[^/]+\/(?:publish|recover))?|(?:stays|rentals)\/owner\/[^/]+)$/.test(
      pathname,
    )
  );
}

export function guardedContribution(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    if (IS_PLAY_EDITION && isContribution(request.method, new URL(request.url).pathname)) {
      const denied = await checkContribution(request);
      if (denied) return denied;
    }
    return handler(request);
  };
}
