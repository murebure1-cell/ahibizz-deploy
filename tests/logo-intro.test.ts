import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { logoIntroBootstrap, logoIntroStorageKey } from "../src/lib/logo-intro";

function run({
  seen,
  lessMotion = false,
  storage = true,
}: {
  seen: string | null;
  lessMotion?: boolean;
  storage?: boolean;
}) {
  const dataset: Record<string, string> = {};
  const asked: string[] = [];
  runInNewContext(logoIntroBootstrap, {
    document: { documentElement: { dataset } },
    matchMedia: (query: string) => {
      asked.push(query);
      return { matches: lessMotion };
    },
    localStorage: {
      getItem(key: string) {
        if (!storage) throw new Error("blocked");
        assert.equal(key, logoIntroStorageKey);
        return seen;
      },
    },
  });
  return { dataset, asked };
}

test("the opening animation is marked to play only on a device that has not seen it", () => {
  assert.deepEqual(run({ seen: null }).dataset, { intro: "play" });
  assert.deepEqual(run({ seen: "1" }).dataset, {});
  // Any stored value means it has been shown; the content is not interpreted.
  assert.deepEqual(run({ seen: "" }).dataset, {});
});

test("the opening animation never plays for people who ask for less motion", () => {
  const { dataset, asked } = run({ seen: null, lessMotion: true });
  assert.deepEqual(dataset, {});
  assert.deepEqual(asked, ["(prefers-reduced-motion: reduce)"]);
});

test("blocked storage leaves the page alone instead of replaying on every visit", () => {
  assert.doesNotThrow(() => run({ seen: null, storage: false }));
  assert.deepEqual(run({ seen: null, storage: false }).dataset, {});
});
