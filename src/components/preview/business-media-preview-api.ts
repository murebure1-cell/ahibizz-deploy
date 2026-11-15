import {
  type BusinessMediaAsset,
  type BusinessMediaKind,
  type BusinessMediaManifest,
  type BusinessMediaReceipt,
  type BusinessMediaStatus,
  readBusinessMediaAsset,
} from "../../lib/business-media";
import {
  BusinessMediaRequestError,
  type businessMediaRequest,
} from "../../lib/business-media-client";

type Business = { id: string; version: number; status: BusinessMediaStatus };
type Normalized = { blob: Blob; width: number; height: number };
function fail(status: number, code = "INVALID_BUSINESS_MEDIA_INPUT"): never {
  throw new BusinessMediaRequestError(status, code);
}

async function normalize(file: Blob, kind: BusinessMediaKind): Promise<Normalized> {
  if (!file.size || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    fail(400, "MEDIA_INVALID");
  if (file.size > 4 * 1024 * 1024) fail(413, "MEDIA_TOO_LARGE");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    view = new DataView(bytes.buffer),
    tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    png = bytes[0] === 137 && tag(1) === "PNG\r",
    webp = tag(0) === "RIFF" && tag(8) === "WEBP";
  if (!jpeg && !png && !webp) fail(400, "MEDIA_INVALID");
  if (webp && view.getUint32(4, true) + 8 !== bytes.length) fail(400, "MEDIA_INVALID");
  if (png || webp)
    for (let p = png ? 8 : 12; p < bytes.length; ) {
      if (p + (png ? 12 : 8) > bytes.length) fail(400, "MEDIA_INVALID");
      const length = view.getUint32(p + (png ? 0 : 4), !png),
        type = tag(p + (png ? 4 : 0));
      const end = p + length + (png ? 12 : 8 + (length % 2));
      if (
        end > bytes.length ||
        ["acTL", "fcTL", "fdAT", "ANIM", "ANMF"].includes(type) ||
        (webp && type === "VP8X" && length > 0 && (bytes[p + 8] ?? 0) & 2)
      )
        fail(400, "MEDIA_INVALID");
      p = end;
    }
  if (typeof createImageBitmap !== "function") fail(400, "MEDIA_INVALID");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    fail(400, "MEDIA_INVALID");
  }
  try {
    if (bitmap.width * bitmap.height > 16_000_000) fail(413, "MEDIA_TOO_LARGE");
    const limitW = kind === "logo" ? 512 : 1600,
      limitH = kind === "logo" ? 512 : kind === "cover" ? 600 : 1200;
    const ratio =
      kind === "gallery"
        ? Math.min(1, limitW / bitmap.width, limitH / bitmap.height)
        : Math.max(limitW / bitmap.width, limitH / bitmap.height);
    const width = kind === "gallery" ? Math.max(1, Math.round(bitmap.width * ratio)) : limitW,
      height = kind === "gallery" ? Math.max(1, Math.round(bitmap.height * ratio)) : limitH;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) fail(400, "MEDIA_INVALID");
    const w = bitmap.width * ratio,
      h = bitmap.height * ratio;
    context.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new BusinessMediaRequestError(400, "MEDIA_INVALID")),
        "image/webp",
        0.84,
      ),
    );
    if (blob.size > 1024 * 1024) fail(413, "MEDIA_TOO_LARGE");
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

/** In-memory media only. This adapter never calls an operational API. */
export function createBusinessMediaPreviewApi({
  readBusiness,
  bumpBusiness,
  normalizeImage = normalize,
  expectedAccountId = "00100000-0000-4000-8000-000000000001",
}: {
  readBusiness: (id: string) => Business | null;
  bumpBusiness: (id: string, expectedVersion: number) => Business;
  normalizeImage?: (file: Blob, kind: BusinessMediaKind) => Promise<Normalized>;
  expectedAccountId?: string;
}) {
  const images = new Map<string, { asset: BusinessMediaAsset; url: string }>(),
    receipts = new Map<string, { fingerprint: string; receipt: BusinessMediaReceipt }>(),
    listeners = new Set<() => void>();
  let revision = 0,
    lifetime = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const key = (id: string, kind: BusinessMediaKind, slot: number) => `${id}/${kind}/${slot}`;
  function manifest(id: string): BusinessMediaManifest {
    const business = readBusiness(id);
    if (!business) fail(404, "BUSINESS_NOT_FOUND");
    const asset = (kind: BusinessMediaKind, slot: number) =>
      images.get(key(id, kind, slot))?.asset ?? null;
    return {
      businessId: id,
      businessVersion: business.version,
      status: business.status,
      logo: asset("logo", 0),
      cover: asset("cover", 0),
      gallery: Array.from({ length: 8 }, (_, i) => asset("gallery", i + 1)).filter(
        (a): a is BusinessMediaAsset => a !== null,
      ),
    };
  }
  const request: typeof businessMediaRequest = async (path, options = {}) => {
    const currentLifetime = lifetime;
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const match =
      /^(mine|public)\/([A-Za-z0-9_-]{1,128})(?:\/(logo|cover|gallery)\/([0-8]))?$/.exec(path);
    if (!match) fail(404, "NOT_FOUND");
    const expected = new Headers(options.headers).get("X-AhiBizz-Account-ID");
    if (match[1] === "mine" && expected !== null) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(expected)) fail(400);
      if (expected !== expectedAccountId) fail(401, "ACCOUNT_IDENTITY_CHANGED");
    }
    const [, area, idText, kindText, slotText] = match,
      id = idText as string,
      kind = kindText as BusinessMediaKind | undefined,
      slot = Number(slotText ?? 0),
      method = (options.method ?? "GET").toUpperCase();
    if (kind && !(kind === "gallery" ? slot >= 1 && slot <= 8 : slot === 0)) fail(400);
    const business = readBusiness(id);
    if (!business) fail(404, "BUSINESS_NOT_FOUND");
    if (method === "GET" && !kind) {
      const current = manifest(id);
      if (area === "public") {
        if (business.status !== "published") fail(404, "BUSINESS_NOT_FOUND");
        const { businessVersion: _v, status: _s, ...safe } = current;
        return { manifest: structuredClone(safe) };
      }
      return { manifest: structuredClone(current) };
    }
    if (area !== "mine" || !kind || !["PUT", "DELETE"].includes(method)) fail(404, "NOT_FOUND");
    const headers = new Headers(options.headers),
      versionMatch = /^"([1-9]\d{0,9})"$/.exec(headers.get("if-match") ?? ""),
      nonce = headers.get("idempotency-key") ?? "";
    if (
      !versionMatch ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)
    )
      fail(400);
    const expectedVersion = Number(versionMatch[1]);
    if (expectedVersion > 2147483646) fail(400);
    let file: Blob | null = null,
      hash = "";
    if (method === "PUT") {
      if (!(options.body instanceof Blob)) fail(400, "MEDIA_INVALID");
      file = options.body;
      if (file.size > 4 * 1024 * 1024) fail(413, "MEDIA_TOO_LARGE");
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(
          headers.get("content-type")?.split(";")[0] ?? "",
        )
      )
        fail(415, "INVALID_CONTENT_TYPE");
      hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    } else if (options.body !== undefined && options.body !== null) fail(400);
    const fingerprint = JSON.stringify([method, id, kind, slot, expectedVersion, hash]),
      prior = receipts.get(nonce.toLowerCase());
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail(409, "IDEMPOTENCY_CONFLICT");
      return { receipt: structuredClone(prior.receipt) };
    }
    if (business.status === "archived") fail(409, "BUSINESS_ARCHIVED");
    if (business.version !== expectedVersion) fail(409, "VERSION_CONFLICT");
    let normalized: Normalized | null = null;
    if (file) normalized = await normalizeImage(file, kind);
    if (currentLifetime !== lifetime || options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    const completed = receipts.get(nonce.toLowerCase());
    if (completed) {
      if (completed.fingerprint !== fingerprint) fail(409, "IDEMPOTENCY_CONFLICT");
      return { receipt: structuredClone(completed.receipt) };
    }
    const fresh = readBusiness(id);
    if (!fresh || fresh.status === "archived") fail(409, "BUSINESS_ARCHIVED");
    if (fresh.version !== expectedVersion) fail(409, "VERSION_CONFLICT");
    if (
      normalized &&
      (!(normalized.blob instanceof Blob) ||
        normalized.blob.type !== "image/webp" ||
        normalized.blob.size > 1024 * 1024)
    )
      fail(400, "MEDIA_INVALID");
    const asset = normalized
      ? readBusinessMediaAsset({
          kind,
          slot,
          version: expectedVersion + 1,
          width: normalized.width,
          height: normalized.height,
        })
      : null;
    const nextUrl = normalized ? URL.createObjectURL(normalized.blob) : null;
    let next: Business;
    try {
      next = bumpBusiness(id, expectedVersion);
    } catch (error) {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      throw error;
    }
    const storageKey = key(id, kind, slot),
      old = images.get(storageKey);
    if (normalized && asset) {
      images.set(storageKey, { asset, url: nextUrl as string });
    } else images.delete(storageKey);
    if (old) URL.revokeObjectURL(old.url);
    const receipt: BusinessMediaReceipt = {
      businessId: id,
      businessVersion: next.version,
      status: next.status,
      kind,
      slot,
      mediaVersion: normalized ? next.version : null,
    };
    receipts.set(nonce.toLowerCase(), { fingerprint, receipt });
    changed();
    return { receipt: structuredClone(receipt) };
  };
  return {
    request,
    getManifest: (id: string) => structuredClone(manifest(id)),
    imageUrl: (id: string, asset: BusinessMediaAsset) => {
      const image = images.get(key(id, asset.kind, asset.slot));
      return image?.asset.version === asset.version ? image.url : null;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshotVersion: () => revision,
    dispose() {
      lifetime++;
      for (const image of images.values()) URL.revokeObjectURL(image.url);
      images.clear();
      receipts.clear();
      listeners.clear();
    },
  };
}
