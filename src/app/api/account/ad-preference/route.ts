import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { readFlatJson } from "../../../../server/flat-json";
import { personalAdPreference } from "../../../../server/marketing/ad-preferences";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const failed = (e: unknown) =>
  e instanceof AccountAccessError
    ? reply({ code: e.code }, e.status)
    : reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
export async function GET(request: Request) {
  if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    return reply(await personalAdPreference(request.headers), 200);
  } catch (e) {
    return failed(e);
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
    const change = await readFlatJson(
      request,
      () => {
        throw new AccountAccessError(400, "INVALID_PREFERENCE");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    );
    return reply(await personalAdPreference(request.headers, change), 200);
  } catch (e) {
    return failed(e);
  }
}
