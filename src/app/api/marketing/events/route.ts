import { IS_PLAY_EDITION } from "../../../../lib/distribution";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { getDatabase } from "../../../../server/db";
import { readFlatJson } from "../../../../server/flat-json";
import { adFrequencyKey, adPlatform, readAdToken } from "../../../../server/marketing/ad-token";

export const dynamic = "force-dynamic";
const result = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (IS_PLAY_EDITION) return result(404);
  const config = readAuthConfiguration();
  if (!config) return result(503);
  if (request.headers.get("origin") !== config.baseURL) return result(403);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return result(415);
  try {
    const data = await readFlatJson(
      request,
      () => {
        throw result(400);
      },
      () => {
        throw result(413);
      },
    );
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length !== 3 ||
      !("tab" in data) ||
      typeof data.tab !== "string" ||
      !/^[a-f0-9-]{36}$/.test(data.tab) ||
      !("token" in data) ||
      !("event" in data)
    )
      return result(400);
    const view = readAdToken(data.token, config.secret);
    if (!view || (data.event !== "view" && data.event !== "click")) return result(400);
    if (data.event === "view" && Date.now() - view.issuedAt < 900) return result(400);
    const header = config.ingress?.ipAddressHeaders[0],
      address = header && request.headers.get(header);
    await getDatabase().query("SELECT record_marketing_ad($1,$2,$3,$4,$5,$6,$7)", [
      view.renderId,
      view.campaignId,
      view.device,
      data.event === "click",
      adFrequencyKey(config.secret, view.campaignId, view.device, "tab", data.tab, view.issuedAt),
      address
        ? adFrequencyKey(
            config.secret,
            view.campaignId,
            view.device,
            "network",
            address,
            view.issuedAt,
          )
        : null,
      adPlatform(request.headers.get("user-agent") ?? ""),
    ]);
    return result(204);
  } catch (error) {
    return error instanceof Response ? error : result(503);
  }
}
