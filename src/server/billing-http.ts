import { IS_PLAY_EDITION } from "../lib/distribution";
import { readAuthConfiguration } from "./auth";
import { AccountAccessError } from "./auth/accounts";
import { getAuthDatabasePool } from "./auth/service";
import {
  BillingAccessError,
  type BillingService,
  getBillingCatalog,
  getBillingService,
} from "./billing";
import { livePackageConfig } from "./paypal-subscriptions/setup";
import { readPlatformCreditsOnly } from "./wallet/platform-policy";
import { readWalletRate } from "./wallet/service";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
function query(url: URL, search = false) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (!["page", ...(search ? ["q"] : [])].includes(key) || Object.hasOwn(result, key))
      throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
    if (key === "page") {
      if (!/^[1-9]\d{0,2}$/.test(value)) throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
      result[key] = Number(value);
    } else result[key] = value;
  }
  return result;
}
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new BillingAccessError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
  }
}
export function createBillingHttpHandler({
  service,
  baseURL,
}: {
  service: BillingService;
  baseURL: string;
}) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (request.url.length > 8192) return reply({ code: "INVALID_BILLING_INPUT" }, 400);
      const path = url.pathname.slice("/api/billing/".length);
      if (!url.pathname.startsWith("/api/billing/")) return reply({ code: "NOT_FOUND" }, 404);
      const receiptMatch = /^admin\/receipts\/([a-f0-9-]{36})$/i.exec(path);
      const commandMatch = /^admin\/commands\/([a-f0-9-]{36})$/i.exec(path);
      if (request.method === "GET") {
        if (path === "catalog") {
          if ([...url.searchParams].length)
            throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
          return reply({ catalog: service.catalog() });
        }
        if (path === "admin" || path === "admin/pending")
          return reply(
            await service.listAdmin(request.headers, query(url), path === "admin/pending"),
          );
        if (path === "admin/businesses")
          return reply(await service.listBusinesses(request.headers, query(url, true)));
        if (path === "admin/development")
          return reply(await service.listDevelopment(request.headers, query(url)));
        if (receiptMatch || commandMatch) {
          if ([...url.searchParams].length)
            throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
          return reply(
            receiptMatch
              ? await service.readReceipt(request.headers, receiptMatch[1] as string)
              : await service.readCommand(request.headers, commandMatch?.[1] as string),
          );
        }
        return reply({ code: "NOT_FOUND" }, 404);
      }
      if (
        !(request.method === "POST" && path === "admin/receipts") &&
        !(request.method === "PATCH" && receiptMatch)
      )
        return reply({ code: "NOT_FOUND" }, 404);
      if ([...url.searchParams].length) throw new BillingAccessError(400, "INVALID_BILLING_INPUT");
      if (request.headers.get("origin") !== new URL(baseURL).origin)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const body = await input(request);
      return receiptMatch
        ? reply(await service.adjustReceipt(request.headers, receiptMatch[1] as string, body))
        : reply(
            await service.createReceipt(
              request.headers,
              body,
              request.headers.get("Idempotency-Key") ?? "",
            ),
            201,
          );
    } catch (error) {
      return error instanceof BillingAccessError || error instanceof AccountAccessError
        ? reply({ code: error.code }, error.status)
        : reply({ code: "BILLING_UNAVAILABLE" }, 503);
    }
  };
}
export function createBillingRequestHandler({
  privateService = getBillingService,
  configuration = readAuthConfiguration,
}: {
  privateService?: () => BillingService | null;
  configuration?: () => { baseURL: string } | null;
} = {}) {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/billing/catalog") {
        if ([...url.searchParams].length || request.url.length > 8192)
          return reply({ code: "INVALID_BILLING_INPUT" }, 400);
        const platformCreditsOnly = readPlatformCreditsOnly();
        const canSell =
          !IS_PLAY_EDITION && process.env.AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED !== "false";
        const pool = canSell ? getAuthDatabasePool() : null;
        const automaticCharging =
          canSell && !platformCreditsOnly && Boolean(await livePackageConfig(pool));
        const checkoutEnabled = platformCreditsOnly
          ? canSell && !!pool && Boolean(await readWalletRate(pool))
          : automaticCharging;
        return reply({
          catalog: {
            ...getBillingCatalog(),
            checkoutEnabled,
            automaticCharging,
            platformCreditsOnly,
          },
        });
      }
      const settings = configuration(),
        service = privateService();
      if (!settings || !service) return reply({ code: "BILLING_UNAVAILABLE" }, 503);
      return createBillingHttpHandler({ service, baseURL: settings.baseURL })(request);
    } catch {
      return reply({ code: "BILLING_UNAVAILABLE" }, 503);
    }
  };
}
export const handleBillingRequest = createBillingRequestHandler();
