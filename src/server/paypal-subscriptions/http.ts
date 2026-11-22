import { initialPackageBenefits } from "../../lib/package-benefits";
import { AccountAccessError } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../auth/service";
import { readFlatJson } from "../flat-json";
import { CheckoutHttpError, readCheckoutJsonBody } from "../paypal/http";
import { readPlatformCreditsOnly } from "../wallet/platform-policy";
import { readWalletRate } from "../wallet/service";
import { adminPackageBenefits, getPackageBenefits } from "./benefits";
import { type SubscriptionEnvironment, sandboxPackageCatalog, subscriptionConfig } from "./config";
import { createSubscriptionProvider } from "./provider";
import { createPackageSubscriptions, fail } from "./service";

import { configureLivePackages, livePackageConfig } from "./setup";

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
export async function handlePackageSubscriptions(
  request: Request,
  environment: SubscriptionEnvironment,
) {
  try {
    const url = new URL(request.url);
    if (url.search || url.href.length > 2048) return reply({ code: "INVALID_REQUEST" }, 400);
    const prefix = environment === "live" ? "/api/paketi/" : "/api/test-paketi/";
    if (!url.pathname.startsWith(prefix)) return reply({ code: "NOT_FOUND" }, 404);
    const path = url.pathname.slice(prefix.length);
    const platformCreditsOnly = environment === "live" && readPlatformCreditsOnly();
    if (platformCreditsOnly && path === "contracts" && request.method === "POST")
      return reply({ code: "PLATFORM_CREDITS_ONLY" }, 409);
    const pool = getAuthDatabasePool();
    const config =
      environment === "live" ? await livePackageConfig(pool) : subscriptionConfig(environment);
    const acceptingOrders =
      !!config &&
      !platformCreditsOnly &&
      (environment !== "live" || process.env.AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED !== "false");
    if (environment === "live" && path === "admin/setup" && request.method === "POST") {
      if (request.headers.get("origin") !== process.env.BETTER_AUTH_URL)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const input = await readFlatJson(
        request,
        () => fail(400, "INVALID_REQUEST"),
        () => fail(413, "REQUEST_TOO_LARGE"),
      );
      if (
        !input ||
        typeof input !== "object" ||
        !Object.hasOwn(input, "enablePackages") ||
        Object.keys(input).length !== 1 ||
        (input as { enablePackages: unknown }).enablePackages !== true
      )
        return reply({ code: "INVALID_REQUEST" }, 400);
      const auth = getAuthService();
      if (!pool || !auth) return reply({ code: "SUBSCRIPTIONS_UNAVAILABLE" }, 503);
      return reply(await configureLivePackages(pool, auth, request.headers));
    }
    if (
      environment === "live" &&
      path === "admin/benefits" &&
      ["GET", "POST"].includes(request.method)
    ) {
      const auth = getAuthService();
      if (!pool || !auth) return reply({ code: "PACKAGES_UNAVAILABLE" }, 503);
      if (request.method === "GET")
        return reply(await adminPackageBenefits(pool, auth, request.headers));
      if (request.headers.get("origin") !== process.env.BETTER_AUTH_URL)
        return reply({ code: "INVALID_ORIGIN" }, 403);
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
      const data = await readFlatJson(
        request,
        () => fail(400, "INVALID_PACKAGE_BENEFITS"),
        () => fail(413, "REQUEST_TOO_LARGE"),
      );
      return reply(await adminPackageBenefits(pool, auth, request.headers, data));
    }
    if (request.method === "GET" && path === "catalog") {
      if (environment === "live" && !pool) return reply({ code: "PACKAGES_UNAVAILABLE" }, 503);
      const schedule =
        environment === "live" && pool
          ? await getPackageBenefits(pool)
          : { version: 1, benefits: initialPackageBenefits };
      return reply({
        ...schedule,
        available: acceptingOrders,
        platformCreditsOnly,
        walletRate:
          environment === "live" &&
          pool &&
          process.env.AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED !== "false"
            ? await readWalletRate(pool)
            : null,
        paypalClientId: acceptingOrders ? (config?.clientId ?? null) : null,
        packages: sandboxPackageCatalog,
        sellable: sandboxPackageCatalog
          .filter((p) => schedule.benefits[p.id].enabled)
          .map((p) => p.id),
        providerCurrency: "EUR",
        catalogCurrency: "BAM",
      });
    }
    const settlements =
      environment === "live" && request.method === "GET"
        ? /^admin\/settlements\/(review\/)?([1-9]\d{0,3})$/.exec(path)
        : null;
    const walletCreate = environment === "live" && path === "contracts/credits";
    const walletCycle =
      environment === "live" ? /^contracts\/([a-f0-9-]{36})\/pay-credits$/i.exec(path) : null;
    const walletAction = request.method === "POST" && (walletCreate || !!walletCycle);
    if (
      !walletAction &&
      !settlements &&
      !config &&
      !(environment === "live" && request.method === "GET" && path === "contracts")
    )
      return reply({ code: "SUBSCRIPTIONS_UNAVAILABLE" }, 503);
    const auth = getAuthService();
    if (!pool || !auth) return reply({ code: "SANDBOX_SUBSCRIPTIONS_UNAVAILABLE" }, 503);
    const service = createPackageSubscriptions({
      environment,
      pool,
      auth,
      plans: config?.plans ?? {},
      provider: config ? createSubscriptionProvider(environment, config) : null,
    });
    if (settlements)
      return reply(
        await service.settlements(request.headers, Number(settlements[2]), Boolean(settlements[1])),
      );
    if (request.method === "GET" && path === "contracts")
      return reply(await service.list(request.headers));
    if (!config && !walletAction) return reply({ code: "SUBSCRIPTIONS_UNAVAILABLE" }, 503);
    if (request.method !== "POST") return reply({ code: "NOT_FOUND" }, 404);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    if (path === "webhook") {
      const { input, rawJson } = await readCheckoutJsonBody(request, 131072);
      return reply(await service.webhook(request.headers, input, rawJson));
    }
    if (
      !request.headers.get("origin") ||
      request.headers.get("origin") !==
        (walletAction ? process.env.BETTER_AUTH_URL : config?.origin)
    )
      return reply({ code: "INVALID_ORIGIN" }, 403);
    const action = /^contracts\/([a-f0-9-]{36})\/(refresh|cancel)$/i.exec(path);
    if (path !== "contracts" && !action && !walletAction) return reply({ code: "NOT_FOUND" }, 404);
    const data = await readFlatJson(
      request,
      () => fail(400, "INVALID_SUBSCRIPTION_INPUT"),
      () => fail(413, "REQUEST_TOO_LARGE"),
    );
    if (walletCreate) {
      if (process.env.AHIBIZZ_LIVE_SUBSCRIPTIONS_ENABLED === "false")
        return reply({ code: "PACKAGE_NOT_AVAILABLE" }, 409);
      return reply(await service.create(request.headers, data, true), 201);
    }
    if (walletCycle?.[1])
      return reply(await service.payCreditCycle(request.headers, walletCycle[1], data));
    if (path === "contracts") {
      if (!acceptingOrders) return reply({ code: "SUBSCRIPTIONS_UNAVAILABLE" }, 503);
      return reply(await service.create(request.headers, data), 201);
    }
    const unpaidOnly =
      platformCreditsOnly &&
      action?.[2] === "cancel" &&
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).length === 1 &&
      "unpaidOnly" in data &&
      data.unpaidOnly === true;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      (Object.keys(data).length && !unpaidOnly) ||
      !action?.[1]
    )
      return reply({ code: "INVALID_SUBSCRIPTION_INPUT" }, 400);
    return reply(
      action[2] === "refresh"
        ? await service.refresh(request.headers, action[1])
        : await service.cancel(request.headers, action[1], Boolean(unpaidOnly)),
    );
  } catch (e) {
    return e instanceof AccountAccessError || e instanceof CheckoutHttpError
      ? reply({ code: e.code }, e.status)
      : reply({ code: "SANDBOX_SUBSCRIPTIONS_UNAVAILABLE" }, 503);
  }
}

export const handleSandboxSubscriptions = (request: Request) =>
  handlePackageSubscriptions(request, "sandbox");
