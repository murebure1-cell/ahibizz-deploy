import { adAssetMaxBytes, isAdAssetType } from "../../../../../lib/ad-asset";
import { businessUuid } from "../../../../../lib/business-today";
import { IS_PLAY_EDITION } from "../../../../../lib/distribution";
import {
  AccountAccessError,
  accountTransaction,
  createAccountAccess,
} from "../../../../../server/auth/accounts";
import { readAuthConfiguration } from "../../../../../server/auth/config";
import { getAuthDatabasePool, getAuthService } from "../../../../../server/auth/service";
import { normalizeAdAsset, readAssetBytes } from "../../../../../server/marketing/ad-asset";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const json = (value: unknown, status: number) =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(e: unknown) {
  return e instanceof AccountAccessError
    ? json({ code: e.code }, e.status)
    : json({ code: "AD_ASSET_UNAVAILABLE" }, 503);
}
const deny = () => new AccountAccessError(404, "NOT_FOUND");
function file(row: { content: Buffer; mime_type: string }, isPublic: boolean) {
  return new Response(new Uint8Array(row.content), {
    headers: {
      "Content-Type": row.mime_type === "text/html" ? "text/plain; charset=utf-8" : row.mime_type,
      "Cache-Control": isPublic ? "public, max-age=0, must-revalidate" : "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (IS_PLAY_EDITION || !businessUuid(id)) throw deny();
    const pool = getAuthDatabasePool();
    if (!pool) throw new AccountAccessError(503, "AD_ASSET_UNAVAILABLE");
    const query = new URL(request.url).searchParams,
      ver = query.get("v");
    if (ver && (!/^[1-9]\d{0,8}$/.test(ver) || query.size !== 1)) throw deny();
    if (request.headers.get("X-AhiBizz-Account-ID")) {
      const auth = getAuthService();
      if (!auth) throw deny();
      const access = createAccountAccess(auth),
        session = await access.session(request.headers);
      return await accountTransaction(pool, async (client) => {
        const actor = await access.authority(client, session, false, "read");
        const row = (
          await client.query(
            `SELECT a.mime_type,a.version,${ver ? "a.content" : "octet_length(a.content) AS size"} FROM marketing_order o JOIN marketing_campaign_brief c ON c.order_id=o.id LEFT JOIN marketing_ad_asset a ON a.order_id=o.id WHERE o.id=$1 AND (o.account_id=$2 OR $3='owner')`,
            [id, actor.id, actor.role],
          )
        ).rows[0];
        if (!row) throw deny();
        if (ver) {
          if (!row.content || String(row.version) !== ver) throw deny();
          return file(row, false);
        }
        return json(
          {
            asset: row.version
              ? { mimeType: row.mime_type, version: row.version, size: row.size }
              : null,
          },
          200,
        );
      });
    }
    if (!ver) throw deny();
    const row = (
      await pool.query(
        `SELECT a.content,a.mime_type FROM marketing_ad_asset a JOIN marketing_order o ON o.id=a.order_id JOIN directory_business b ON b.id=o.business_id AND b.owner_user_id=o.account_id JOIN auth_user u ON u.id=o.account_id WHERE a.order_id=$1 AND a.version=$2 AND o.status='paid' AND o.kind='banner' AND o.revoked_at IS NULL AND o.starts_at<=now() AND o.ends_at>now() AND b.status='published' AND b.deleted_at IS NULL AND package_allows_listing(b) AND u.approval='approved' AND u."emailVerified" AND u.role IN ('owner','member')`,
        [id, Number(ver)],
      )
    ).rows[0];
    if (!row) throw deny();
    return file(row, true);
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (IS_PLAY_EDITION || !businessUuid(id)) throw deny();
    if (
      request.headers.get("origin") !==
      new URL(readAuthConfiguration()?.baseURL ?? "https://invalid.invalid").origin
    )
      return json({ code: "INVALID_ORIGIN" }, 403);
    const mime = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "",
      expected = request.headers.get("X-Asset-Version") ?? "";
    if (!isAdAssetType(mime)) return json({ code: "INVALID_AD_ASSET" }, 415);
    if (!/^(0|[1-9]\d{0,8})$/.test(expected)) return json({ code: "INVALID_VERSION" }, 400);
    if (Number(request.headers.get("content-length") ?? 0) > adAssetMaxBytes)
      return json({ code: "AD_ASSET_TOO_LARGE" }, 413);
    if (!request.headers.get("X-AhiBizz-Account-ID"))
      return json({ code: "AUTHENTICATION_REQUIRED" }, 401);
    const auth = getAuthService(),
      pool = getAuthDatabasePool();
    if (!auth || !pool) throw deny();
    const access = createAccountAccess(auth),
      session = await access.session(request.headers);
    // Authenticate before decoding, then recheck eligibility under the same order lock as quoting.
    const actor = await accountTransaction(pool, async (c) => {
      const u = await access.authority(c, session, false, "read");
      const ok = await c.query(
        "SELECT 1 FROM marketing_order o JOIN marketing_campaign_brief c ON c.order_id=o.id WHERE o.id=$1 AND o.account_id=$2 AND o.status='requested'",
        [id, u.id],
      );
      if (!ok.rowCount) throw deny();
      return u.id;
    });
    const asset = await normalizeAdAsset(await readAssetBytes(request), mime);
    return await accountTransaction(pool, async (c) => {
      const u = await access.authority(c, session);
      if (u.id !== actor) throw deny();
      const order = await c.query(
        "SELECT 1 FROM marketing_order WHERE id=$1 AND account_id=$2 AND status='requested' FOR UPDATE",
        [id, actor],
      );
      if (!order.rowCount) throw new AccountAccessError(409, "CAMPAIGN_CHANGED");
      const old = (
        await c.query(
          "SELECT version,content=$2 AND mime_type=$3 AS same FROM marketing_ad_asset WHERE order_id=$1",
          [id, asset.content, asset.mimeType],
        )
      ).rows[0];
      if (old?.same && (old.version === Number(expected) || old.version === Number(expected) + 1))
        return json(
          { asset: { mimeType: asset.mimeType, version: old.version, size: asset.content.length } },
          200,
        );
      if ((old?.version ?? 0) !== Number(expected))
        throw new AccountAccessError(409, "ASSET_CHANGED");
      const result = await c.query(
        "INSERT INTO marketing_ad_asset(order_id,mime_type,content) VALUES($1,$2,$3) ON CONFLICT(order_id) DO UPDATE SET content=excluded.content,mime_type=excluded.mime_type,version=marketing_ad_asset.version+1,updated_at=now() RETURNING version",
        [id, asset.mimeType, asset.content],
      );
      return json(
        {
          asset: {
            mimeType: asset.mimeType,
            version: result.rows[0].version,
            size: asset.content.length,
          },
        },
        200,
      );
    });
  } catch (e) {
    return failure(e);
  }
}
