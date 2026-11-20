import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { readFlatJson } from "../../../../server/flat-json";
import { adminAdPricing } from "../../../../server/marketing/ad-pricing";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status: number) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  return error instanceof AccountAccessError
    ? reply({ code: error.code }, error.status)
    : reply({ code: "RATE_CARD_UNAVAILABLE" }, 503);
}
export async function GET(request: Request) {
  if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    return reply(await adminAdPricing(request.headers), 200);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    if (
      request.headers.get("origin") !==
      new URL(readAuthConfiguration()?.baseURL ?? "https://invalid.invalid").origin
    )
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    const input = await readFlatJson(
      request,
      () => {
        throw new AccountAccessError(400, "INVALID_RATE_CARD");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    );
    return reply(await adminAdPricing(request.headers, input), 200);
  } catch (error) {
    return failure(error);
  }
}
