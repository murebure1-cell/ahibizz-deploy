import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANDROID_LINK_RELATION,
  ANDROID_PACKAGE,
  androidAssetStatements,
  isAhiBizzAndroidLaunch,
} from "../src/lib/android-association";

const first = Array(32).fill("AB").join(":");
const second = Array(32).fill("CD").join(":");

test("the AhiBizz Android launcher selects the installed layout without matching another app", () => {
  assert.equal(isAhiBizzAndroidLaunch("android-app://com.ahibizz.app/"), true);
  assert.equal(isAhiBizzAndroidLaunch("android-app://com.ahibizz.app.qa"), true);
  for (const other of [
    "",
    "https://com.ahibizz.app/",
    "android-app://com.ahibizz.app.fake/",
    "android-app://wrong.app/",
    "android-app://",
  ]) {
    assert.equal(isAhiBizzAndroidLaunch(other), false);
  }
});

test("a blank, partial or malformed signing identity cannot publish an association", () => {
  for (const invalid of [undefined, "", "AB:CD", `${first},00`, "ab".repeat(32)]) {
    assert.deepEqual(androidAssetStatements(invalid), []);
  }
});

test("asset links publish only the declared Play package and distinct signing fingerprints", () => {
  assert.deepEqual(androidAssetStatements(`${first.toLowerCase()}, ${first}, ${second}`), [
    {
      relation: [ANDROID_LINK_RELATION],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [first, second],
      },
    },
  ]);
});

test("the handover template requires a real signing certificate before publication", () => {
  const [template] = JSON.parse(
    readFileSync(new URL("../docs/handover/assetlinks.example.json", import.meta.url), "utf8"),
  );
  assert.equal(template.target.package_name, ANDROID_PACKAGE);
  assert.deepEqual(template.relation, [ANDROID_LINK_RELATION]);
  assert.deepEqual(androidAssetStatements(template.target.sha256_cert_fingerprints.join(",")), []);
});
