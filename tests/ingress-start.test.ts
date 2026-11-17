import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { enforcementEnv } from "./ingress-enforcement-fixtures";

const lifecycle = await import(new URL("../scripts/ingress-start.mjs", import.meta.url).href);
const policyLib = await import(new URL("../scripts/ingress-policy.mjs", import.meta.url).href);

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

function send(port: number, options: { path?: string; localAddress?: string; body?: string } = {}) {
  return new Promise<{ status: number; body: string; cookies?: string[]; location?: string }>(
    (resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          localAddress: options.localAddress ?? "127.0.0.1",
          agent: false,
          path: options.path ?? "/echo",
          method: options.body ? "POST" : "GET",
          headers: {
            Host: "fixture.example.invalid",
            "X-Real-IP": "203.0.113.9",
            "X-AhiBizz-Account-ID": "fixture-actor",
            "X-AhiBizz-Ingress-Client-IP": "198.51.100.123",
            Cookie: "fixture=private-value",
          },
          timeout: 500,
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              body,
              cookies: response.headers["set-cookie"],
              location: response.headers.location,
            }),
          );
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Fixture request timeout.")));
      req.end(options.body);
    },
  );
}

async function untilReady(port: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await send(port, { path: "/api/health/live" })).status === 200) return;
    } catch {}
    await delay(25);
  }
  throw new Error("Isolated ingress did not become ready.");
}

async function fixture(t: TestContext, mode = "normal") {
  const root = mkdtempSync(path.join(tmpdir(), "ahibizz-enforced-start-"));
  const eventFile = path.join(root, "events.jsonl");
  mkdirSync(path.join(root, "scripts"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  for (const file of [
    "start.mjs",
    "ingress-evidence.mjs",
    "ingress-policy.mjs",
    "ingress-forwarder.mjs",
    "ingress-start.mjs",
    "ingress-observe.mjs",
  ])
    writeFileSync(
      path.join(root, "scripts", file),
      readFileSync(new URL(`../scripts/${file}`, import.meta.url)),
    );
  const record = `import {appendFileSync} from 'node:fs';import {hasSubscribers} from 'node:diagnostics_channel';const record = e=>appendFileSync(process.env.START_EVENTS, JSON.stringify(e)+'\\n');`;
  writeFileSync(
    path.join(root, "scripts/migrate.mjs"),
    `${record}record({step:'migration',wrapped:process.env.AHIBIZZ_INGRESS_WRAPPED,observes:hasSubscribers('http.server.request.start')});process.exitCode=Number(process.env.MIGRATION_EXIT||0);`,
  );
  const server = path.join(root, "server.js");
  writeFileSync(
    server,
    `${record}
import {createServer} from 'node:http';
record({step:'child',pid:process.pid,host:process.env.HOSTNAME,port:process.env.PORT,
 wrapped:process.env.AHIBIZZ_INGRESS_WRAPPED,publicPort:process.env.AHIBIZZ_INGRESS_PUBLIC_PORT,
 observes:hasSubscribers('http.server.request.start')});
if (${JSON.stringify(mode)} === 'exit') process.exit(27);
if (${JSON.stringify(mode)} !== 'silent') {
 const s=createServer((req,res)=>{
  if(req.url==='/api/health/live'||req.url==='/api/health/ready') {res.end(JSON.stringify({status:'ok'}));return;}
  if(req.url==='/exit') {res.end('stopping');setTimeout(()=>process.exit(19),20);return;}
  if(req.url==='/slow') {res.write('first');setTimeout(()=>res.end('last'),100);return;}
  if(req.url==='/redirect') {res.writeHead(307,{'Set-Cookie':['fixture=a; HttpOnly','other=b; Secure'],'Location':'/nalog'});res.end();return;}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>res.end(JSON.stringify({body,headers:req.headers})));
 });
 s.listen(Number(process.env.PORT),process.env.HOSTNAME);
 process.on('SIGTERM',()=>s.close(()=>process.exit(0)));
 process.on('SIGINT',()=>s.close(()=>process.exit(0)));
}
setTimeout(()=>process.exit(29),30000).unref();
`,
  );
  const publicPort = await freePort();
  let internalPort = await freePort();
  while (internalPort === publicPort) internalPort = await freePort();
  const env = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    NODE_ENV: "production" as const,
    ...enforcementEnv(internalPort),
    PORT: String(publicPort),
    START_EVENTS: eventFile,
  };
  t.after(() => {
    if (existsSync(eventFile)) {
      for (const row of readFileSync(eventFile, "utf8").trim().split(/\r?\n/)) {
        const event = JSON.parse(row) as { step: string; pid?: number };
        if (event.step === "child" && event.pid) {
          try {
            process.kill(event.pid, "SIGKILL");
          } catch {}
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    server,
    publicPort,
    internalPort,
    env,
    events: () =>
      existsSync(eventFile)
        ? readFileSync(eventFile, "utf8")
            .trim()
            .split(/\r?\n/)
            .map((line) => JSON.parse(line))
        : [],
  };
}

test("invalid enforcement fails before migration; a definite migration failure never starts a listener", async (t) => {
  const app = await fixture(t);
  const run = (changes: Partial<NodeJS.ProcessEnv>) =>
    spawnSync(process.execPath, [path.join(app.root, "scripts/start.mjs")], {
      cwd: app.root,
      env: { ...app.env, DATABASE_URL: "fixture-only", ...changes },
      encoding: "utf8",
      timeout: 5000,
    });
  const invalid = run({ AHIBIZZ_INGRESS_BOUNDARY_PROOF: "{}" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /configuration is invalid/);
  assert.deepEqual(app.events(), []);
  const migration = run({ MIGRATION_EXIT: "23" });
  assert.equal(migration.status, 23);
  assert.deepEqual(app.events(), [{ step: "migration", observes: false }]);
  await assert.rejects(send(app.publicPort));
});

test("an explicit false flag leaves the original public child startup and ignores unused proof fields", async (t) => {
  const app = await fixture(t, "exit");
  const result = spawnSync(process.execPath, [path.join(app.root, "scripts/start.mjs")], {
    cwd: app.root,
    env: { ...app.env, AHIBIZZ_INGRESS_ENFORCE: "false", AHIBIZZ_INGRESS_BOUNDARY_PROOF: "{}" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 27, result.stderr);
  assert.equal(app.events()[0].host, "0.0.0.0");
  assert.equal(app.events()[0].port, String(app.publicPort));
  assert.equal(app.events()[0].wrapped, undefined);
});

test("the actual entrypoint migrates, binds Next to loopback and exposes only guarded streaming ingress", async (t) => {
  const app = await fixture(t);
  const parent = spawn(process.execPath, [path.join(app.root, "scripts/start.mjs")], {
    cwd: app.root,
    env: { ...app.env, DATABASE_URL: "fixture-only", AHIBIZZ_INGRESS_OBSERVE: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  parent.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  parent.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) => parent.once("close", resolve));
  t.after(() => parent.kill("SIGKILL"));
  await untilReady(app.publicPort);
  assert.deepEqual(
    app.events().map((row) => row.step),
    ["migration", "child"],
  );
  const child = app.events()[1];
  assert.equal(child.host, "127.0.0.1");
  assert.equal(child.port, String(app.internalPort));
  assert.equal(child.publicPort, String(app.publicPort));
  assert.equal(child.wrapped, "true");
  assert.equal(child.observes, false);
  assert.equal(app.events()[0].observes, false);
  const response = await send(app.publicPort, { body: "fixture-auth-body" });
  const received = JSON.parse(response.body);
  assert.equal(received.body, "fixture-auth-body");
  assert.equal(received.headers["x-ahibizz-ingress-client-ip"], undefined);
  assert.equal(received.headers["x-ahibizz-account-id"], "fixture-actor");
  assert.equal(received.headers.cookie, "fixture=private-value");
  assert.equal((await send(app.publicPort, { localAddress: "127.0.0.2" })).status, 403);
  await assert.rejects(
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.2", port: app.internalPort, timeout: 200 }, resolve);
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Timeout.")));
      req.end();
    }),
  );
  const redirect = await send(app.publicPort, { path: "/redirect" });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.cookies?.length, 2);
  assert.equal(redirect.location, "/nalog");
  const observedPath = "/api/health/live?ingressProbe=013579bd-1234-4123-8123-0123456789ab";
  assert.equal((await send(app.publicPort, { path: observedPath })).status, 200);
  assert.equal(
    (await send(app.publicPort, { path: observedPath, localAddress: "127.0.0.2" })).status,
    403,
  );
  await send(app.publicPort, { path: "/exit" });
  assert.equal(await exited, 19, stderr);
  const observations = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(observations.length, 2);
  assert.ok(observations.every((row) => row.pid === parent.pid));
  assert.deepEqual(
    observations.map((row) => row.peer.address),
    ["127.0.0.1", "127.0.0.2"],
  );
  assert.equal(stdout.includes("private-value"), false);
  assert.equal(stdout.includes("fixture-actor"), false);
  await assert.rejects(send(app.publicPort));
  assert.equal(
    app.events().filter((row) => row.step === "child").length,
    1,
    "No automatic child replay.",
  );
});

test("SIGTERM drains a real child response, closes both ports and allows a clean process restart", async (t) => {
  const app = await fixture(t);
  const policy = policyLib.readIngressEnforcementPolicy(app.env);
  const begin = () =>
    lifecycle.runEnforcedServer({
      root: app.root,
      server: app.server,
      env: app.env,
      policy,
      shutdownGraceMs: 1000,
    });
  const result = begin();
  await untilReady(app.publicPort);
  const stream = send(app.publicPort, { path: "/slow" });
  await delay(30);
  process.emit("SIGTERM", "SIGTERM");
  assert.equal((await stream).body, "firstlast");
  assert.equal(await result, 143);
  await assert.rejects(send(app.publicPort));
  await assert.rejects(send(app.internalPort));
  const restarted = begin();
  await untilReady(app.publicPort);
  process.emit("SIGINT", "SIGINT");
  assert.equal(await restarted, 130);
  assert.equal(app.events().filter((row) => row.step === "child").length, 2);
});

test("a failed or silent child never leaves the public listener open", async (t) => {
  for (const mode of ["exit", "silent"]) {
    const app = await fixture(t, mode);
    const code = await lifecycle.runEnforcedServer({
      root: app.root,
      server: app.server,
      env: app.env,
      policy: policyLib.readIngressEnforcementPolicy(app.env),
      startupTimeoutMs: 300,
      shutdownGraceMs: 100,
    });
    assert.equal(code, 1);
    await assert.rejects(send(app.publicPort));
    await assert.rejects(send(app.internalPort));
  }
});
