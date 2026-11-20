import sharp from "sharp";
import { type AdAssetType, adAssetMaxBytes, isAdAssetType } from "../../lib/ad-asset";
import { AccountAccessError } from "../auth/accounts";

const invalid = () => new AccountAccessError(400, "INVALID_AD_ASSET");
export async function readAssetBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > adAssetMaxBytes) {
        await reader.cancel();
        throw new AccountAccessError(413, "AD_ASSET_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw invalid();
  return Buffer.concat(chunks);
}
export async function normalizeAdAsset(
  content: Buffer,
  mime: string,
): Promise<{ content: Buffer; mimeType: AdAssetType }> {
  if (!content.length || content.length > adAssetMaxBytes || !isAdAssetType(mime)) throw invalid();
  if (mime === "text/html") {
    let html: string;
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw invalid();
    }
    // Render a self-contained creative with movement supplied by CSS. Uploaded markup is
    // served as plain text. The client uses an opaque, scriptless frame with an independent CSP.
    const allowed = new Set(
      "html head title style body main section article header footer div span p strong b em i small h1 h2 h3 h4 picture img ul ol li br hr".split(
        " ",
      ),
    );
    const tags = Array.from(
      html.matchAll(/<\/?\s*([a-z][a-z0-9:-]*)\b/gi),
      (m) => m[1]?.toLowerCase() ?? "",
    );
    if (
      !tags.length ||
      tags.some((t) => !allowed.has(t)) ||
      /\son[a-z]+\s*=|<\?|<!\[CDATA\[/i.test(html)
    )
      throw invalid();
    return { content: Buffer.from(html, "utf8"), mimeType: mime };
  }
  if (mime === "video/mp4") {
    if (
      content.length < 24 ||
      content.readUInt32BE(0) < 16 ||
      content.readUInt32BE(0) > content.length ||
      content.toString("ascii", 4, 8) !== "ftyp"
    )
      throw invalid();
    const brand = content.toString("ascii", 8, 12);
    if (!/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(brand)) throw invalid();
    let offset = 0,
      moov = false,
      mdat = false;
    while (offset + 8 <= content.length) {
      const size = content.readUInt32BE(offset) || content.length - offset,
        name = content.toString("ascii", offset + 4, offset + 8);
      if (size < 8 || size > content.length - offset) throw invalid();
      if (name === "moov" && size > 8) moov = true;
      if (name === "mdat" && size > 8) mdat = true;
      offset += size;
    }
    if (offset !== content.length || !moov || !mdat) throw invalid();
    return { content, mimeType: mime };
  }
  try {
    const input = sharp(content, { animated: true, limitInputPixels: 12000000, failOn: "error" });
    const meta = await input.metadata();
    if (
      "image/" + meta.format !== mime ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 180 ||
      meta.width * meta.height > 12000000
    )
      throw invalid();
    const cleaned = await input.toBuffer();
    if (cleaned.length > adAssetMaxBytes) throw invalid();
    return { content: cleaned, mimeType: mime };
  } catch {
    throw invalid();
  }
}
