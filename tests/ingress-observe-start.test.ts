import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

function fixture(t: TestContext, layout: "checkout" | "image") {
  const root = mkdtempSync(path.join(tmpdir(), "ahibizz-ingress-start-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  for (const name of ["start.mjs", "ingress-observe.mjs"])
    writeFileSync(
      path.join(root, "scripts", name),
      readFileSync(new URL(`../scripts/${name}`, import.meta.url)),
    );
  const stub = (step: string) =>
    `import {hasSubscribers} from 'node:diagnostics_channel';console.log('${step} '+hasSubscribers('http.server.request.start'));`;
  writeFileSync(path.join(root, "scripts/migrate.mjs"), stub("MIGRATION_OBSERVES"));
  const server = path.join(
    root,
    layout === "checkout" ? ".next/standalone/server.js" : "server.js",
  );
  mkdirSync(path.dirname(server), { recursive: true });
  writeFileSync(server, stub("SERVER_OBSERVES"));
  return (enabled?: string) => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/start.mjs")], {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        NODE_ENV: "production",
        PORT: "43127",
        DATABASE_URL: "postgresql://fixture.invalid/not-used-by-stub",
        AHIBIZZ_INGRESS_OBSERVE: enabled,
      },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(/\r?\n/);
  };
}

for (const layout of ["checkout", "image"] as const)
  test(`the ${layout} startup preloads observations only in the opt-in server child, never migration`, (t) => {
    const run = fixture(t, layout);
    assert.deepEqual(run(), ["MIGRATION_OBSERVES false", "SERVER_OBSERVES false"]);
    assert.deepEqual(run("false"), ["MIGRATION_OBSERVES false", "SERVER_OBSERVES false"]);
    assert.deepEqual(run("true"), ["MIGRATION_OBSERVES false", "SERVER_OBSERVES true"]);
  });
