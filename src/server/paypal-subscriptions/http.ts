import { initialPackageBenefits } from "../../lib/package-benefits";
import { AccountAccessError } from "../auth/accounts";
import { getAuthDatabasePool, getAuthService } from "../auth/service";
import { readFlatJson } from "../flat-json";
import { CheckoutHttpError, readCheckoutJsonBody } from "../paypal/http";
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
    const pool = getAuthDatabasePool();
    const config =
      environment === "live" ? await livePackageConfig(pool) : subscriptionConfig(environment);
    const acceptingOrders =
      !!config &&
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
        ? /^admin\/settlements\/([1-9]\d{0,3})$/.exec(path)
        : null;
    if (
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
      return reply(await service.settlements(request.headers, Number(settlements[1])));
    if (request.method === "GET" && path === "contracts")
      return reply(await service.list(request.headers));
    if (!config) return reply({ code: "SUBSCRIPTIONS_UNAVAILABLE" }, 503);
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
    if (request.headers.get("origin") !== config.origin)
      return reply({ code: "INVALID_ORIGIN" }, 403);
    const action = /^contracts\/([a-f0-9-]{36})\/(refresh|cancel)$/i.exec(path);
    if (path !== "contracts" && !action) return reply({ code: "NOT_FOUND" }, 404);
    const data = await readFlatJson(
      request,
      () => fail(400, "INVALID_SUBSCRIPTION_INPUT"),
      () => fail(413, "REQUEST_TOO_LARGE"),
    );
    if (path === "contracts") {
      if (!acceptingOrders) return reply({ code: "SUBSCRIPTIONS_UNAVAILABLE" }, 503);
      return reply(await service.create(request.headers, data), 201);
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length ||
      !action?.[1]
    )
      return reply({ code: "INVALID_SUBSCRIPTION_INPUT" }, 400);
    return reply(
      action[2] === "refresh"
        ? await service.refresh(request.headers, action[1])
        : await service.cancel(request.headers, action[1]),
    );
  } catch (e) {
    return e instanceof AccountAccessError || e instanceof CheckoutHttpError
      ? reply({ code: e.code }, e.status)
      : reply({ code: "SANDBOX_SUBSCRIPTIONS_UNAVAILABLE" }, 503);
  }
}

export const handleSandboxSubscriptions = (request: Request) =>
  handlePackageSubscriptions(request, "sandbox");
