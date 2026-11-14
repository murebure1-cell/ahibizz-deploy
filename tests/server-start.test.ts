import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

type Event = {
  step: "migration" | "server";
  port?: string;
  hostname?: string;
  nodeEnv?: string;
  cwd?: string;
};

const startupSource = readFileSync(new URL("../scripts/start.mjs", import.meta.url));
const recordEvent = `
import { appendFileSync } from "node:fs";
function record(event) {
  appendFileSync(process.env.START_TEST_EVENTS, JSON.stringify(event) + "\\n");
}
`;

function fixture(t: TestContext, layout: "checkout" | "image" | "missing" = "checkout") {
  const root = mkdtempSync(path.join(tmpdir(), "ahibizz-start-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(root, "scripts/start.mjs"), startupSource);
  writeFileSync(
    path.join(root, "scripts/migrate.mjs"),
    `${recordEvent}
record({ step: "migration" });
process.exitCode = Number(process.env.START_TEST_MIGRATION_EXIT ?? 0);
`,
  );

  if (layout !== "missing") {
    const server = path.join(
      root,
      layout === "checkout" ? ".next/standalone/server.js" : "server.js",
    );
    mkdirSync(path.dirname(server), { recursive: true });
    writeFileSync(
      server,
      `${recordEvent}
record({ step: "server", port: process.env.PORT, hostname: process.env.HOSTNAME,
  nodeEnv: process.env.NODE_ENV, cwd: process.cwd() });
process.exitCode = Number(process.env.START_TEST_SERVER_EXIT ?? 0);
`,
    );
  }

  return {
    root,
    run(overrides: Partial<NodeJS.ProcessEnv> = {}) {
      const eventsPath = path.join(root, "events.jsonl");
      // Do not inherit database credentials, NODE_OPTIONS or any test-runner preload.
      const env: NodeJS.ProcessEnv = {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        PORT: "43127",
        HOSTNAME: "must-be-overridden",
        NODE_ENV: "development",
        START_TEST_EVENTS: eventsPath,
        ...overrides,
      };
      const result = spawnSync(process.execPath, [path.join(root, "scripts/start.mjs")], {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      const events: Event[] = existsSync(eventsPath)
        ? readFileSync(eventsPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Event)
        : [];
      return { ...result, events };
    },
  };
}

test("missing PORT rejects startup before any migration or server runs", (t) => {
  const result = fixture(t).run({
    PORT: undefined,
    DATABASE_URL: "postgresql://fixture.invalid/db",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set PORT to a valid port/);
  assert.deepEqual(result.events, []);
});

test("invalid ports reject startup before any migration or server runs", async (t) => {
  for (const port of ["", "0", "65536", "-1", "3000.5", "not-a-port"]) {
    await t.test(JSON.stringify(port), (child) => {
      const result = fixture(child).run({
        PORT: port,
        DATABASE_URL: "postgresql://fixture.invalid/db",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Set PORT to a valid port/);
      assert.deepEqual(result.events, []);
    });
  }
});

test("missing standalone build rejects startup before migration", (t) => {
  const result = fixture(t, "missing").run({ DATABASE_URL: "postgresql://fixture.invalid/db" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Standalone server missing/);
  assert.deepEqual(result.events, []);
});

for (const layout of ["checkout", "image"] as const) {
  test(`the ${layout} standalone layout starts without a configured database`, (t) => {
    const app = fixture(t, layout);
    const result = app.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /starting without database readiness/);
    assert.deepEqual(result.events, [
      { step: "server", port: "43127", hostname: "0.0.0.0", nodeEnv: "production", cwd: app.root },
    ]);
  });
}

test("configured startup waits for successful migration before starting the server", (t) => {
  const app = fixture(t);
  const result = app.run({ DATABASE_URL: "postgresql://fixture.invalid/db" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, [
    { step: "migration" },
    { step: "server", port: "43127", hostname: "0.0.0.0", nodeEnv: "production", cwd: app.root },
  ]);
});

test("a failed migration preserves its exit code and prevents the server from starting", (t) => {
  const result = fixture(t).run({
    DATABASE_URL: "postgresql://fixture.invalid/db",
    START_TEST_MIGRATION_EXIT: "23",
  });
  assert.equal(result.status, 23);
  assert.deepEqual(result.events, [{ step: "migration" }]);
});

test("an explicitly empty database URL does not bypass the migration gate", (t) => {
  const result = fixture(t).run({ DATABASE_URL: "", START_TEST_MIGRATION_EXIT: "1" });
  assert.equal(result.status, 1);
  assert.deepEqual(result.events, [{ step: "migration" }]);
});

test("a failed server process preserves its exit code", (t) => {
  const result = fixture(t, "image").run({ START_TEST_SERVER_EXIT: "17" });
  assert.equal(result.status, 17);
  assert.deepEqual(
    result.events.map((event) => event.step),
    ["server"],
  );
});
