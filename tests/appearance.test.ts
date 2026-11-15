import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { appearanceBootstrap, isAppearance, resolveAppearance } from "../src/lib/appearance";

test("appearance accepts only supported preferences and system follows the OS", () => {
  for (const invalid of [undefined, null, {}, "Dark", "auto", "dark; color:red"])
    assert.equal(isAppearance(invalid), false);
  for (const value of ["system", "light", "dark"] as const) assert.equal(isAppearance(value), true);
  assert.equal(resolveAppearance("system", true), "dark");
  assert.equal(resolveAppearance("system", false), "light");
  assert.equal(resolveAppearance("light", true), "light");
  assert.equal(resolveAppearance("dark", false), "dark");
});

test("first-paint bootstrap honors explicit or system preference without accepting arbitrary data", () => {
  for (const [cached, systemDark, expected] of [
    ["dark", false, "dark"],
    ["light", true, "light"],
    ["system", true, "dark"],
    ["invalid", false, "light"],
    [null, true, "dark"],
  ] as const) {
    const dataset: Record<string, string> = {};
    runInNewContext(appearanceBootstrap, {
      document: { documentElement: { dataset } },
      localStorage: { getItem: () => cached },
      matchMedia: () => ({ matches: systemDark }),
    });
    assert.equal(dataset.theme, expected);
    assert.equal(dataset.appearance, isAppearance(cached) ? cached : "system");
  }
});

test("first-paint bootstrap does not break page startup when storage is blocked", () => {
  const dataset: Record<string, string> = {};
  assert.doesNotThrow(() => {
    runInNewContext(appearanceBootstrap, {
      document: { documentElement: { dataset } },
      matchMedia: () => ({ matches: true }),
      localStorage: {
        getItem() {
          throw new Error("blocked");
        },
      },
    });
  });
  assert.deepEqual(dataset, { appearance: "system", theme: "dark" });
});
