import { createHash } from "node:crypto";
import { businessUuid } from "../../../../lib/business-today";
import { normalizeMessageBody } from "../../../../lib/messaging";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../server/auth/config";
import { getAuthDatabasePool } from "../../../../server/auth/service";
import { readFlatJson } from "../../../../server/flat-json";
import { getMessagingService } from "../../../../server/messaging/service";
import { MessagingAccessError } from "../../../../server/messaging/validation";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status: number) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  try {
    if (
      request.headers.get("origin") !==
      new URL(readAuthConfiguration()?.baseURL ?? "https://invalid.invalid").origin
    )
      return reply({ code: "INVALID_ORIGIN" }, 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
      return reply({ code: "INVALID_CONTENT_TYPE" }, 415);
    if (!request.headers.get("X-AhiBizz-Account-ID"))
      return reply({ code: "AUTHENTICATION_REQUIRED" }, 401);
    const parsed = await readFlatJson(
      request,
      () => {
        throw new AccountAccessError(400, "INVALID_INQUIRY");
      },
      () => {
        throw new AccountAccessError(413, "REQUEST_TOO_LARGE");
      },
    );
    const input = parsed as Record<string, unknown> | null;
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).length !== 4 ||
      !businessUuid(input.id) ||
      !businessUuid(input.businessId) ||
      !businessUuid(input.campaignId)
    )
      return reply({ code: "INVALID_INQUIRY" }, 400);
    let body: string;
    try {
      body = normalizeMessageBody(input.body);
    } catch {
      return reply({ code: "INVALID_INQUIRY" }, 400);
    }
    const pool = getAuthDatabasePool(),
      service = getMessagingService();
    if (!pool || !service) return reply({ code: "INQUIRY_UNAVAILABLE" }, 503);
    const active = await pool.query(
      `SELECT 1 FROM marketing_order o JOIN marketing_campaign_brief c ON c.order_id=o.id
      JOIN directory_business b ON b.id=o.business_id AND b.owner_user_id=o.account_id JOIN auth_user u ON u.id=o.account_id
      WHERE o.id=$1 AND b.id=$2 AND c.format IN ('lead_form','loan_calculator') AND o.kind='banner'
      AND o.status='paid' AND o.revoked_at IS NULL AND o.starts_at<=now() AND o.ends_at>now() AND b.deleted_at IS NULL
      AND b.status='published' AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified" AND u.role IN ('member','owner')`,
      [input.campaignId, input.businessId],
    );
    if (!active.rowCount) return reply({ code: "CAMPAIGN_CLOSED" }, 410);
    // Open and send are independently idempotent. Browser retries use the same pair.
    const digest = createHash("sha256")
      .update("ad-inquiry-open/" + input.id)
      .digest("hex");
    const openKey = [
      digest.slice(0, 8),
      digest.slice(8, 12),
      "4" + digest.slice(13, 16),
      "8" + digest.slice(17, 20),
      digest.slice(20, 32),
    ].join("-");
    const thread = await service.open(
      request.headers,
      { kind: "business", targetId: input.businessId },
      openKey,
    );
    const receipt = await service.send(request.headers, thread.threadId, { body }, input.id);
    return reply({ threadId: receipt.threadId }, 200);
  } catch (error) {
    if (error instanceof MessagingAccessError || error instanceof AccountAccessError)
      return reply({ code: error.code }, error.status);
    return reply({ code: "INQUIRY_UNAVAILABLE" }, 503);
  }
}
