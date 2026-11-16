import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

type Address = {
  valid: boolean;
  family?: number;
  scope?: string;
  fingerprint?: string;
  address?: string;
};
type Field = {
  status: string;
  fieldCount: number;
  tokenCount: number;
  validCount: number;
  fingerprints: Address[];
};
type Observation = {
  event: string;
  nonce: string;
  observationOnly: boolean;
  trustedForAuthentication: boolean;
  peer: Address;
  headers: { realIp?: Field; forwardedFor?: Field; status?: string };
};
type Input = { url: string; method?: string; headers?: string[]; body?: string };
type Outcome = {
  status: number;
  body: string;
  cookies: string[];
};
const observerUrl = new URL("../scripts/ingress-observe.mjs", import.meta.url);
const observer: {
  normalizeIngressAddress(value: unknown): string | null;
  createIngressObserver(options?: {
    enabled?: boolean;
    now?: () => number;
    emit?: (row: Observation) => void;
  }): (message: unknown) => void;
} = await import(observerUrl.href);
const nonce = "013579bd-1234-4123-8123-0123456789ab";
const probe = `/api/health/live?ingressProbe=${nonce}`;
const fingerprint = (ip: string, key = nonce) =>
  createHash("sha256")
    .update(key + ip)
    .digest("hex");

function message(address: string, rawHeaders: string[] = [], url = probe, method = "GET") {
  return { request: { method, url, rawHeaders, socket: { remoteAddress: address } } };
}

function runHttp(t: TestContext, cases: Input[], enabled?: string) {
  const root = mkdtempSync(path.join(tmpdir(), "ahibizz-ingress-http-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "server.mjs");
  writeFileSync(
    script,
    `
import assert from 'node:assert/strict';import {createServer,request} from 'node:http';
const cases=JSON.parse(process.env.INGRESS_TEST_CASES),outcomes=[];let current=0,handled=0;
const server=createServer(async(req,res)=>{const expected=cases[current];handled++;let body='';for await(const chunk of req)body+=chunk;
assert.equal(req.url,expected.url);assert.equal(req.method,expected.method??'GET');assert.equal(body,expected.body??'');
for(let index=0;index<(expected.headers?.length??0);index+=2){const key=expected.headers[index].toLowerCase();const actual=[];for(let j=0;j<req.rawHeaders.length;j+=2)if(req.rawHeaders[j].toLowerCase()===key)actual.push(req.rawHeaders[j+1]);const wanted=[];for(let j=0;j<expected.headers.length;j+=2)if(expected.headers[j].toLowerCase()===key)wanted.push(expected.headers[j+1]);assert.deepEqual(actual,wanted);}
res.statusCode=207;res.setHeader('Set-Cookie',['fixture-a=1; HttpOnly','fixture-b=2; Secure']);res.write('streamed-');await new Promise(resolve=>setImmediate(resolve));res.end('unchanged');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
for(const entry of cases){const result=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:entry.url,method:entry.method??'GET',headers:["Host","127.0.0.1",...(entry.headers??[])],agent:false},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body,cookies:res.headers['set-cookie']}));});req.on('error',reject);req.end(entry.body??'');});outcomes.push(result);current++;}
await new Promise(resolve=>server.close(resolve));console.log('HARNESS_RESULT '+JSON.stringify({outcomes,handled}));
`,
  );
  const result = spawnSync(process.execPath, ["--import", observerUrl.href, script], {
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      NODE_ENV: "production",
      AHIBIZZ_INGRESS_OBSERVE: enabled,
      INGRESS_TEST_CASES: JSON.stringify(cases),
    },
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  const observations = lines
    .filter((line) => line.startsWith('{"event":"ahibizz_ingress_observe"'))
    .map((line) => JSON.parse(line) as Observation);
  const output = lines.find((line) => line.startsWith("HARNESS_RESULT "));
  assert.ok(output);
  const evidence = JSON.parse(output.slice("HARNESS_RESULT ".length)) as {
    outcomes: Outcome[];
    handled: number;
  };
  assert.equal(evidence.handled, cases.length);
  for (const outcome of evidence.outcomes)
    assert.deepEqual(outcome, {
      status: 207,
      body: "streamed-unchanged",
      cookies: ["fixture-a=1; HttpOnly", "fixture-b=2; Secure"],
    });
  return { observations, evidence, stdout: result.stdout };
}

test("observer default-off and false options leave real HTTP requests, streams and cookies unchanged", (t) => {
  const cases = [
    { url: probe, headers: ["X-Real-IP", "203.0.113.1"] },
    { url: "/api/auth/sign-in/email", method: "POST", body: "fixture-body-secret" },
  ];
  for (const flag of [undefined, "false", "TRUE"])
    assert.deepEqual(runHttp(t, cases, flag).observations, []);
});

test("actual HTTP diagnostic channel observes exactly the selected request without touching application IO", (t) => {
  const cases = [
    {
      url: probe,
      headers: [
        "X-Real-IP",
        "203.0.113.1",
        "X-Forwarded-For",
        "198.51.100.2, 10.0.0.1",
        "Cookie",
        "session=fixture-cookie-secret",
        "Authorization",
        "Bearer fixture-token-secret",
        "X-Other",
        "fixture-other-secret",
      ],
    },
    { url: "/api/health/live" },
    { url: `/API/HEALTH/LIVE?ingressProbe=${nonce}` },
    { url: `/api/health/live?ingressprobe=${nonce}` },
    { url: probe, method: "POST", body: "fixture-body-secret" },
    { url: `${probe}&extra=fixture-query-secret` },
    { url: `${probe}&ingressProbe=${nonce}` },
    { url: "/api/health/live?ingressProbe=not-a-uuid" },
    { url: "/api/auth/sign-in/email", method: "POST", body: "fixture-password-secret" },
    { url: "/account?token=fixture-url-secret" },
  ];
  const enabled = runHttp(t, cases, "true");
  const disabled = runHttp(t, cases);
  assert.deepEqual(enabled.evidence, disabled.evidence);
  assert.equal(enabled.observations.length, 1);
  const row = enabled.observations[0];
  assert.ok(row);
  assert.equal(row.observationOnly, true);
  assert.equal(row.trustedForAuthentication, false);
  assert.equal(row.peer.address, "127.0.0.1");
  assert.equal(row.headers.realIp?.fingerprints[0]?.fingerprint, fingerprint("203.0.113.1"));
  assert.equal(row.headers.forwardedFor?.validCount, 2);
  const serialized = JSON.stringify(enabled.observations);
  for (const secret of [
    "203.0.113.1",
    "198.51.100.2",
    "10.0.0.1",
    "fixture-cookie-secret",
    "fixture-token-secret",
    "fixture-other-secret",
    "fixture-body-secret",
    "fixture-query-secret",
    "fixture-password-secret",
    "fixture-url-secret",
  ])
    assert.equal(serialized.includes(secret), false, secret);
});

test("raw duplicate fields are reported without merging or trusting spoofed values", (t) => {
  const result = runHttp(
    t,
    [
      {
        url: probe,
        headers: [
          "X-Real-IP",
          "203.0.113.3",
          "x-real-ip",
          "198.51.100.3",
          "X-Forwarded-For",
          "203.0.113.4",
          "x-forwarded-for",
          "198.51.100.4",
        ],
      },
    ],
    "true",
  );
  assert.equal(result.observations.length, 1);
  for (const field of ["realIp", "forwardedFor"] as const) {
    const value = result.observations[0]?.headers[field];
    assert.equal(value?.status, "duplicate_fields");
    assert.equal(value?.fieldCount, 2);
    assert.deepEqual(value?.fingerprints, []);
  }
});

test("normalization compares mapped IPv6 and canonical addresses without retaining header IPs", (t) => {
  const result = runHttp(
    t,
    [
      { url: probe, headers: ["X-Real-IP", "::ffff:203.0.113.9"] },
      { url: probe, headers: ["X-Real-IP", "203.0.113.9"] },
      { url: probe, headers: ["X-Real-IP", "2001:0DB8:0000:0000:0000:0000:0000:0001"] },
      { url: probe, headers: ["X-Real-IP", "2001:db8::1"] },
    ],
    "true",
  );
  assert.equal(result.observations.length, 4, "A repeated nonce can compare separate routes.");
  assert.deepEqual(result.observations[0]?.headers.realIp, result.observations[1]?.headers.realIp);
  assert.deepEqual(result.observations[2]?.headers.realIp, result.observations[3]?.headers.realIp);
  assert.equal(observer.normalizeIngressAddress("::ffff:cb00:7109"), "203.0.113.9");
  assert.equal(observer.normalizeIngressAddress("fe80::1%eth0"), null);
  assert.equal(observer.normalizeIngressAddress("203.0.113.9:443"), null);
});

test("only private and loopback peers expose an address; public peers remain nonce-bound fingerprints", () => {
  const rows: Observation[] = [];
  const observe = observer.createIngressObserver({ enabled: true, emit: (row) => rows.push(row) });
  for (const ip of ["172.18.0.1", "::ffff:192.168.1.2", "::1", "fd12::1", "203.0.113.9", "fe80::1"])
    observe(message(ip, ["X-Real-IP", "10.2.3.4"]));
  assert.deepEqual(
    rows.map((row) => row.peer.address),
    ["172.18.0.1", "192.168.1.2", "::1", "fd12::1", undefined, undefined],
  );
  assert.equal(rows[4]?.peer.fingerprint, fingerprint("203.0.113.9"));
  for (const row of rows) assert.equal(row.headers.realIp?.fingerprints[0]?.address, undefined);
  observe(message("203.0.113.9", [], probe.replace(nonce, "113579bd-1234-4123-8123-0123456789ab")));
  assert.notEqual(rows[4]?.peer.fingerprint, rows[6]?.peer.fingerprint);
  observe(message("fixture-remote-secret"));
  assert.deepEqual(rows[7]?.peer, { valid: false });
  assert.equal(JSON.stringify(rows).includes("fixture-remote-secret"), false);
});

test("malformed, oversized and multivalue inputs emit bounded fixed metadata, never their contents", () => {
  const rows: Observation[] = [];
  const observe = observer.createIngressObserver({ enabled: true, emit: (row) => rows.push(row) });
  for (const headers of [
    ["X-Real-IP", "203.0.113.1, 198.51.100.1"],
    ["X-Forwarded-For", "203.0.113.1, fixture-header-secret"],
    ["X-Forwarded-For", "203.0.113.1,,198.51.100.1"],
    ["X-Real-IP", "fixture-too-long-secret".repeat(120)],
    ["X-Forwarded-For", Array(17).fill("203.0.113.1").join(",")],
  ])
    observe(message("127.0.0.1", headers));
  assert.equal(rows[0]?.headers.realIp?.status, "multiple_values");
  assert.equal(rows[1]?.headers.forwardedFor?.status, "malformed_value");
  assert.equal(rows[2]?.headers.forwardedFor?.status, "malformed_value");
  assert.equal(rows[3]?.headers.realIp?.status, "too_long_or_invalid");
  assert.equal(rows[4]?.headers.forwardedFor?.status, "too_many_values");
  observe(message("127.0.0.1", Array(514).fill("fixture-extra-secret")));
  assert.equal(rows[5]?.headers.status, "raw_headers_unavailable_or_over_limit");
  assert.equal(JSON.stringify(rows).includes("fixture-"), false);
  for (const url of [
    `${probe}#fragment`,
    `${probe}\n`,
    probe.replace("ingressProbe", "%69ngressProbe"),
    `https://fixture.invalid${probe}`,
  ])
    observe(message("127.0.0.1", [], url));
  assert.equal(rows.length, 6);
});

test("public probes cannot cause unbounded logs and every HTTP request still completes", (t) => {
  const result = runHttp(
    t,
    Array.from({ length: 32 }, () => ({ url: probe })),
    "true",
  );
  assert.equal(result.observations.length, 24);
  assert.equal(result.evidence.handled, 32);
  let clock = 0;
  const rows: Observation[] = [];
  const observe = observer.createIngressObserver({
    enabled: true,
    now: () => clock,
    emit: (row) => rows.push(row),
  });
  for (let minute = 0; minute < 10; minute++) {
    clock = minute * 60_000;
    for (let count = 0; count < 30; count++) observe(message("127.0.0.1"));
  }
  assert.equal(rows.length, 96);
});

test("diagnostic subscriber failures and invalid messages cannot throw into application handling", () => {
  const observe = observer.createIngressObserver({
    enabled: true,
    emit: () => {
      throw new Error("fixture-sink-error");
    },
  });
  assert.doesNotThrow(() => observe(message("127.0.0.1")));
  for (const value of [null, undefined, {}, { request: null }, { request: { method: "GET" } }])
    assert.doesNotThrow(() => observe(value));
});

test("the runtime Docker copy includes the opt-in preload without adding an entrypoint or trust switch", () => {
  const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const copy = docker
    .split(/\r?\n/)
    .find((line) => line.startsWith("COPY ") && line.includes("/app/scripts/start.mjs"));
  assert.ok(copy?.includes("/app/scripts/ingress-observe.mjs"));
  assert.ok(docker.includes('CMD ["node", "scripts/start.mjs"]'));
  assert.equal(fileURLToPath(observerUrl).endsWith("ingress-observe.mjs"), true);
});
