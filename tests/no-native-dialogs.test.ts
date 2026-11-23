import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("the interface never uses browser alert, confirm or prompt dialogs", () => {
  // Play/TWA shells and in-app browsers can suppress native dialogs; ConfirmButton is used instead.
  const offenders = sources(join(process.cwd(), "src")).filter((path) =>
    /\bwindow\.(alert|confirm|prompt)\s*\(/.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(offenders, []);
});
