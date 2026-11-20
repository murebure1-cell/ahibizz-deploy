import { IS_PLAY_EDITION } from "../../../lib/distribution";
import type { MarketingMode } from "../../../lib/marketing";
import { AccountAccessError } from "../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../server/auth/config";
import { readFlatJson } from "../../../server/flat-json";
import { getMarketingService } from "../../../server/marketing/service";

export const dynamic = "force-dynamic";
function reply(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
function failure(error: unknown) {
  return error instanceof AccountAccessError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "MARKETING_UNAVAILABLE" }, 503);
}
function service(request: Request) {
  if (IS_PLAY_EDITION) throw new AccountAccessError(404, "NOT_FOUND");
  if (!request.headers.get("X-AhiBizz-Account-ID"))
    throw new AccountAccessError(401, "ACCOUNT_IDENTITY_CHANGED");
  const store = getMarketingService();
  if (!store) throw new AccountAccessError(503, "MARKETING_UNAVAILABLE");
  return store;
}
export async function GET(request: Request) {
  try {
    const store = service(request),
      query = new URL(request.url).searchParams;
    const mode = query.get("mode"),
      page = query.get("page") ?? "0";
    if (!mode || !/^(?:admin|ads|credits)$/.test(mode) || !/^\d{1,3}$/.test(page))
      return reply({ code: "INVALID_OFFER" }, 400);
    return reply(await store.read(request.headers, mode as MarketingMode, Number(page)), 200);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const store = service(request);
    if (
      request.headers.get("origin") !==
      new URL(readAuthConfiguration()?.baseURL ?? "https://invalid.invalid").origin
    )
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    const data = await readFlatJson(
      request,
      () => {
        throw new AccountAccessError(400, "INVALID_OFFER");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    );
    return reply(await store.command(request.headers, data), 200);
  } catch (error) {
    return failure(error);
  }
}
