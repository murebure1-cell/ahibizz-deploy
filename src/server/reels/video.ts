import { reelMaxDuration, reelMinDuration, reelPartBytes, reelPosterEdge } from "../../lib/reels";
import { AccountAccessError } from "../auth/accounts";
import { normalizeRasterImage, RasterImageError } from "../media/normalize-image";

const invalidVideo = () => new AccountAccessError(422, "REEL_VIDEO_INVALID");
type Box = { type: string; content: Buffer; headerAt: number; endAt: number };

/** Read one ISO BMFF level. A byte limit and a box count cap bound processing. */
function boxes(bytes: Buffer): Box[] {
  const result: Box[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    if (bytes.length - offset < 8 || result.length >= 4096) throw invalidVideo();
    let length = bytes.readUInt32BE(offset);
    let header = 8;
    if (length === 1) {
      if (bytes.length - offset < 16) throw invalidVideo();
      const extendedLength = bytes.readBigUInt64BE(offset + 8);
      if (extendedLength < 16n || extendedLength > BigInt(bytes.length - offset))
        throw invalidVideo();
      length = Number(extendedLength);
      header = 16;
    }
    if (!length) length = bytes.length - offset;
    if (length < header || length > bytes.length - offset) throw invalidVideo();
    result.push({
      type: bytes.toString("latin1", offset + 4, offset + 8),
      content: bytes.subarray(offset + header, offset + length),
      headerAt: bytes.byteOffset + offset,
      endAt: bytes.byteOffset + offset + length,
    });
    offset += length;
  }
  return result;
}

function one(siblings: Box[], name: string): Buffer {
  const [first, extra] = siblings.filter((box) => box.type === name);
  if (!first || extra) throw invalidVideo();
  return first.content;
}

function duration(header: Buffer): number {
  if (header.length < 20) throw invalidVideo();
  const version = header.readUInt8(0);
  let scale: number;
  let ticks: number;
  if (version === 0) {
    scale = header.readUInt32BE(12);
    ticks = header.readUInt32BE(16);
  } else if (version === 1 && header.length >= 32) {
    scale = header.readUInt32BE(20);
    ticks = Number(header.readBigUInt64BE(24));
  } else {
    throw invalidVideo();
  }
  if (!scale || !Number.isSafeInteger(ticks)) throw invalidVideo();
  return (ticks / scale) * 1000;
}

function mimeCompatibleTrack(track: Box): { video: boolean; duration: number } {
  const media = boxes(one(boxes(track.content), "mdia"));
  const handler = one(media, "hdlr");
  if (handler.length < 12) throw invalidVideo();
  const type = handler.toString("latin1", 8, 12);
  if (type !== "vide" && type !== "soun") throw invalidVideo();
  const information = boxes(one(media, "minf"));
  const references = one(boxes(one(information, "dinf")), "dref");
  if (references.length < 8 || references.readUInt32BE(4) !== 1) throw invalidVideo();
  const [location, extraLocation] = boxes(references.subarray(8));
  if (
    !location ||
    extraLocation ||
    location.type !== "url " ||
    location.content.length !== 4 ||
    location.content.readUInt32BE(0) !== 1
  )
    throw invalidVideo();
  const sampleTable = boxes(one(information, "stbl"));
  const sizes = one(sampleTable, "stsz");
  if (sizes.length < 12 || sizes.readUInt32BE(8) === 0) throw invalidVideo();
  const offsets = sampleTable.filter((box) => box.type === "stco" || box.type === "co64");
  if (
    offsets.length !== 1 ||
    !offsets[0] ||
    offsets[0].content.length < 8 ||
    offsets[0].content.readUInt32BE(4) === 0
  )
    throw invalidVideo();
  const descriptions = one(sampleTable, "stsd");
  if (descriptions.length < 8 || descriptions.readUInt32BE(4) !== 1) throw invalidVideo();
  const [codec, extra] = boxes(descriptions.subarray(8));
  if (!codec || extra || codec.content.length < 8 || codec.content.readUInt16BE(6) !== 1)
    throw invalidVideo();
  if (type === "soun") {
    if (codec.type !== "mp4a") throw invalidVideo();
    return { video: false, duration: duration(one(media, "mdhd")) };
  }
  if (!["avc1", "avc3"].includes(codec.type) || codec.content.length < 78) throw invalidVideo();
  const width = codec.content.readUInt16BE(24);
  const height = codec.content.readUInt16BE(26);
  if (!width || !height || width > 1920 || height > 1920) throw invalidVideo();
  if (one(boxes(codec.content.subarray(78)), "avcC").length < 7) throw invalidVideo();
  return { video: true, duration: duration(one(media, "mdhd")) };
}

export function verifyReelVideo(bytes: Buffer): { durationMs: number; metadataParts: number[] } {
  const atoms = boxes(bytes);
  if (
    atoms[0]?.type !== "ftyp" ||
    atoms[0].content.length < 8 ||
    atoms.some((box) => box.type === "moof")
  )
    throw invalidVideo();
  const brand = atoms[0].content.toString("latin1", 0, 4);
  if (!/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(brand)) throw invalidVideo();
  const data = atoms.filter((box) => box.type === "mdat");
  if (!data.some((box) => box.content.length > 0)) throw invalidVideo();
  const movie = boxes(one(atoms, "moov"));
  const tracks = movie.filter((box) => box.type === "trak");
  if (tracks.length < 1 || tracks.length > 2) throw invalidVideo();
  const verified = tracks.map(mimeCompatibleTrack);
  const movieDuration = duration(one(movie, "mvhd"));
  const maximum = reelMaxDuration * 1000;
  const minimum = reelMinDuration * 1000;
  if (
    verified.filter((track) => track.video).length !== 1 ||
    verified.some(
      (track) => track.duration > maximum + 25 || (track.video && track.duration < minimum),
    ) ||
    movieDuration < minimum ||
    movieDuration > maximum
  )
    throw invalidVideo();
  // Replacing metadata boxes in place preserves the sample offsets in players.
  const scrubbed = new Set<number>();
  const scrub = (level: Box[]) => {
    for (const box of level) {
      if (box.type === "udta" || box.type === "meta" || box.type === "uuid") {
        const start = box.headerAt - bytes.byteOffset + 4;
        const end = box.endAt - bytes.byteOffset;
        bytes.write("free", start, 4, "ascii");
        bytes.fill(0, box.content.byteOffset - bytes.byteOffset, end);
        for (
          let index = Math.floor(start / reelPartBytes);
          index <= Math.floor((end - 1) / reelPartBytes);
          index++
        )
          scrubbed.add(index);
      } else if (["moov", "trak", "mdia"].includes(box.type)) {
        scrub(boxes(box.content));
      }
    }
  };
  scrub(atoms);
  return { durationMs: Math.ceil(movieDuration), metadataParts: [...scrubbed] };
}

export async function readReelPart(request: Request, length: number | null): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  const limit = length ?? reelPartBytes;
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new AccountAccessError(413, "REEL_PART_SIZE");
  const reader = request.body?.getReader();
  if (!reader) throw new AccountAccessError(400, "REEL_PART_SIZE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new AccountAccessError(413, "REEL_PART_SIZE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size || (length !== null && size !== length))
    throw new AccountAccessError(400, "REEL_PART_SIZE");
  return Buffer.concat(chunks, size);
}

export async function normalizeReelPoster(input: Buffer) {
  try {
    const target = await normalizeRasterImage(input, {
      width: reelPosterEdge,
      height: 960,
      fit: "inside",
      withoutEnlargement: true,
    });
    if (target.bytes.length > reelPartBytes) throw new AccountAccessError(413, "REEL_PART_SIZE");
    return target.bytes;
  } catch (error) {
    if (error instanceof RasterImageError)
      throw new AccountAccessError(error.status, "REEL_POSTER_INVALID");
    throw error;
  }
}
