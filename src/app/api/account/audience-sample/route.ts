import { isAudienceChoice } from "../../../../lib/ad-audience-sample";
import { businessUuid } from "../../../../lib/business-today";
import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { measurementChoice, recordAudienceNavigation } from "../../../../server/ad-audience-sample";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { readFlatJson } from "../../../../server/flat-json";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const failed = (e: unknown) =>
  e instanceof AccountAccessError
    ? reply({ code: e.code }, e.status)
    : reply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
export async function GET(req: Request) {
  if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    return reply({ choice: await measurementChoice(req.headers) }, 200);
  } catch (e) {
    return failed(e);
  }
}
export async function POST(req: Request) {
  if (IS_PLAY_EDITION) return reply({ code: "NOT_FOUND" }, 404);
  try {
    if (
      req.headers.get("origin") !==
      new URL(readAuthConfiguration()?.baseURL ?? "https://invalid.invalid").origin
    )
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (req.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    const value = (await readFlatJson(
      req,
      () => {
        throw new AccountAccessError(400, "INVALID_INPUT");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    )) as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return reply({ code: "INVALID_INPUT" }, 400);
    if (
      Object.keys(value).length === 1 &&
      businessUuid(value.eventId) &&
      typeof value.eventId === "string"
    )
      return reply({ enabled: await recordAudienceNavigation(req.headers, value.eventId) }, 200);
    if (
      Object.keys(value).length !== 2 ||
      !isAudienceChoice(value.choice) ||
      !isAudienceChoice(value.expected)
    )
      return reply({ code: "INVALID_INPUT" }, 400);
    return reply(
      {
        choice: await measurementChoice(req.headers, {
          choice: value.choice,
          expected: value.expected,
        }),
      },
      200,
    );
  } catch (e) {
    return failed(e);
  }
}
