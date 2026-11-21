import assert from "node:assert/strict";
import test from "node:test";
import { reelMaxBytes } from "../src/lib/reels";
import { AccountAccessError } from "../src/server/auth/accounts";
import { readReelRange } from "../src/server/reels/range";
import { parseReelCommand } from "../src/server/reels/service";
import { verifyReelVideo } from "../src/server/reels/video";

function box(type: string, ...parts: Buffer[]) {
  const total = 8 + parts.reduce((sum, bytes) => sum + bytes.length, 0);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(total);
  header.write(type, 4, 4);
  return Buffer.concat([header, ...parts], total);
}

function fixtureMovie(codec: "avc1" | "hvc1", duration: number) {
  const time = Buffer.alloc(20);
  time.writeUInt32BE(1000, 12);
  time.writeUInt32BE(duration, 16);
  const handler = Buffer.alloc(12);
  handler.write("vide", 8);
  const sample = Buffer.alloc(78);
  sample.writeUInt16BE(1, 6);
  sample.writeUInt16BE(360, 24);
  sample.writeUInt16BE(640, 26);
  const count = Buffer.alloc(8);
  count.writeUInt32BE(1, 4);
  const size = Buffer.alloc(12);
  size.writeUInt32BE(1, 8);
  return Buffer.concat([
    box("ftyp", Buffer.from("isom\x00\x00\x00\x00", "latin1")),
    box("mdat", Buffer.from("test-frame")),
    box(
      "moov",
      box("mvhd", time),
      box("udta", box("meta", Buffer.from("test-private-device-tag"))),
      box(
        "trak",
        box(
          "mdia",
          box("hdlr", handler),
          box("mdhd", time),
          box(
            "minf",
            box("dinf", box("dref", count, box("url ", Buffer.from([0, 0, 0, 1])))),
            box(
              "stbl",
              box("stco", count),
              box("stsz", size),
              box("stsd", count, box(codec, sample, box("avcC", Buffer.alloc(7)))),
            ),
          ),
        ),
      ),
    ),
  ]);
}

test("Reel validation enforces H.264 and duration and strips private container metadata", () => {
  const movie = fixtureMovie("avc1", 2000);
  const length = movie.length;
  assert.deepEqual(verifyReelVideo(movie), { durationMs: 2000, metadataParts: [0] });
  assert.equal(movie.length, length);
  assert.equal(movie.includes(Buffer.from("test-private-device-tag")), false);
  assert.equal(movie.includes(Buffer.from("test-frame")), true);
  for (const input of [
    fixtureMovie("avc1", 90001),
    fixtureMovie("hvc1", 2000),
    Buffer.from("<html>"),
  ]) {
    assert.throws(
      () => verifyReelVideo(input),
      (error: unknown) =>
        error instanceof AccountAccessError && error.code === "REEL_VIDEO_INVALID",
    );
  }
});

test("Byte range support covers native probes, suffixes, seeking and unsatisfiable requests", () => {
  assert.deepEqual(readReelRange(null, 100), { start: 0, end: 99 });
  assert.deepEqual(readReelRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(readReelRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(readReelRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(readReelRange("bytes=90-200", 100), { start: 90, end: 99 });
  for (const input of ["bytes=100-", "bytes=20-12", "bytes=-0", "bytes=0-1,20-21", "pixels=0-1"]) {
    assert.equal(readReelRange(input, 100), null);
  }
});

test("Reel writes require explicit state and bounded metadata", () => {
  const input = {
    action: "create",
    businessId: "6bd4452f-73fc-4eb5-92d1-f9cf4bf2d57e",
    title: "  Prvi pogled ",
    caption: "Prva linija\r\nDruga linija",
    bytes: reelMaxBytes,
    poster: false,
  };
  assert.deepEqual(parseReelCommand(input), {
    ...input,
    title: "Prvi pogled",
    caption: "Prva linija\nDruga linija",
  });
  for (const invalid of [
    { ...input, bytes: reelMaxBytes + 1 },
    { ...input, title: "  " },
    { ...input, autoPublish: true },
    { action: "withdraw", expected: "completed" },
    { action: "reject", reason: "" },
  ])
    assert.throws(() => parseReelCommand(invalid), AccountAccessError);
});
