// Operator tool for the schema-2 ingress boundary proof. The procedure is in
// docs/handover/OPERACIJE.md ("Novi dokaz granice").
//
//   node scripts/ingress-prove.mjs probe    --origin https://example.com --gateway-ip 203.0.113.1 \
//                                           --direct http://203.0.113.1:3056 --out controlled.json
//   node scripts/ingress-prove.mjs assemble --controlled controlled.json --log provider.log \
//                                           --source-commit <40 hex> --manifest sha256:<64 hex> \
//                                           --deployed <ISO time> --checked <ISO time> \
//                                           --internal-port <port> --out-dir <dir>
//
// "probe" sends the nine controlled GET health requests, without cookies or a body, while the
// deployment runs with AHIBIZZ_INGRESS_OBSERVE=true. "assemble" pairs them with the observer lines
// copied from the provider's runtime log and refuses to write a proof that production would reject.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readIngressEnforcementPolicy } from "./ingress-policy.mjs";

const appId = 213;
/** Each variant with the extra request headers it sends; null stands for the canonical host. */
export const proofVariants = Object.freeze([
  ["canonical-base", []],
  ["canonical-spoof-real-one", ["X-Real-IP", "198.51.100.1"]],
  ["canonical-spoof-real-two", ["X-Real-IP", "198.51.100.2"]],
  [
    "canonical-spoof-chain",
    ["X-Real-IP", "198.51.100.3", "X-Forwarded-For", "198.51.100.4, 127.0.0.1"],
  ],
  ["canonical-duplicate-real", ["X-Real-IP", "198.51.100.5", "X-Real-IP", "198.51.100.6"]],
  [
    "canonical-duplicate-forwarded",
    ["X-Forwarded-For", "198.51.100.7", "X-Forwarded-For", "198.51.100.8"],
  ],
  ["direct-base", []],
  [
    "direct-forged-host",
    ["Host", null, "X-Real-IP", "198.51.100.9", "X-Forwarded-For", "198.51.100.10"],
  ],
  ["direct-forged-local", ["Host", null, "X-Real-IP", "127.0.0.1", "X-Forwarded-For", "10.0.0.1"]],
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Builds the proof from the controlled requests and the provider log, then runs the same policy
 * reader production runs at startup. Throws when that reader would refuse the proof.
 */
export function assembleBoundaryProof({
  origin,
  controlled,
  providerLog,
  sourceCommit,
  manifest,
  deployedUtc,
  checkedUtc,
  internalPort,
}) {
  const log = providerLog.replace(/\r\n/g, "\n").trim();
  const events = [];
  for (const line of log.split("\n")) {
    const index = line.indexOf("{");
    if (index < 0) continue;
    try {
      const event = JSON.parse(line.slice(index));
      if (event.event === "ahibizz_ingress_observe" && event.nonce === controlled.nonce)
        events.push(event);
    } catch {
      // Other provider lines are not evidence.
    }
  }
  if (events.length !== proofVariants.length)
    throw new Error(`Expected 9 observer lines for the nonce, found ${events.length}.`);
  const peer = events[0].peer?.address;
  if (typeof peer !== "string")
    throw new Error("The first observation has no private peer address.");
  const proof = {
    schema: 2,
    appId,
    origin,
    operatorReviewed: true,
    observerSourceCommit: sourceCommit,
    deployment: { sourceCommit, manifest, completedUtc: deployedUtc },
    observerProof: {
      appId,
      sourceCommit,
      checkedUtc,
      nonce: controlled.nonce,
      request: {
        method: "GET",
        path: controlled.path,
        status: 200,
        authCookies: false,
        bodySent: false,
      },
      observation: events[0],
      observations: proofVariants.map(([variant], index) => ({
        variant,
        observation: events[index],
      })),
      providerLogSha256: sha256(log),
      productionAuthRequests: 0,
      applicationDatabaseWrites: 0,
      trustChanged: false,
      canonicalExactPeer: peer,
    },
    controlledRequests: { ...controlled, sourceCommit },
    providerLog: log,
  };
  const raw = JSON.stringify(proof);
  const digest = sha256(raw);
  const policy = readIngressEnforcementPolicy({
    AHIBIZZ_INGRESS_ENFORCE: "true",
    AHIBIZZ_INGRESS_TRUST_CLIENT_IP: "false",
    PORT: String(new URL(controlled.requests[6].origin).port || 80),
    AHIBIZZ_NEXT_INTERNAL_PORT: String(internalPort),
    AHIBIZZ_INGRESS_PROXY_PEERS: peer,
    BETTER_AUTH_URL: origin,
    AHIBIZZ_INGRESS_BOUNDARY_PROOF: raw,
    AHIBIZZ_INGRESS_BOUNDARY_SHA256: digest,
  });
  if (!policy?.enabled || policy.origin !== origin)
    throw new Error("The policy did not enable for this origin.");
  return { raw, sha256: digest, peer };
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Bad argument: ${key}`);
    result[key.slice(2)] = value;
  }
  return result;
}
function need(args, ...names) {
  for (const name of names) if (!args[name]) throw new Error(`Missing --${name}`);
}

function get({ secure, connectHost, port, servername, requestPath, rawHeaders }) {
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(
      {
        host: connectHost,
        port,
        method: "GET",
        path: requestPath,
        // The raw form sends duplicate fields exactly as listed and adds no Host by itself.
        headers: rawHeaders,
        agent: false,
        timeout: 15_000,
        ...(secure ? { servername } : {}),
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("timeout", () => request.destroy(new Error("timeout")));
    request.once("error", reject);
    request.end();
  });
}

async function probe(args) {
  need(args, "origin", "gateway-ip", "direct", "out");
  const origin = new URL(args.origin);
  const direct = new URL(args.direct);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || direct.protocol !== "http:")
    throw new Error("Expected an https origin and an http direct address.");
  const nonce = randomUUID();
  const requestPath = `/api/health/live?ingressProbe=${nonce}`;
  const requests = [];
  const startedUtc = new Date().toISOString();
  for (const [index, [variant, template]] of proofVariants.entries()) {
    const canonical = index < 6;
    const headers = template.map((value) => (value === null ? origin.host : value));
    const forgedHost = headers.some((value, at) => at % 2 === 0 && value.toLowerCase() === "host");
    const rawHeaders = [
      ...(forgedHost ? [] : ["Host", canonical ? origin.host : direct.host]),
      ...headers,
      "Accept",
      "application/json",
    ];
    const dispatchedUtc = new Date().toISOString();
    const status = await get({
      secure: canonical,
      // The gateway address is given explicitly, so a stale DNS answer cannot redirect the probe.
      connectHost: canonical ? args["gateway-ip"] : direct.hostname,
      port: canonical ? 443 : Number(direct.port || 80),
      servername: origin.hostname,
      requestPath,
      rawHeaders,
    });
    requests.push({
      variant,
      origin: canonical ? origin.origin : direct.origin,
      method: "GET",
      path: requestPath,
      headers,
      attempts: 1,
      state: "completed",
      status,
      authCookies: false,
      bodySent: false,
      dispatchedUtc,
      completedUtc: new Date().toISOString(),
    });
    console.log(`${variant}: ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const controlled = {
    appId,
    nonce,
    path: requestPath,
    startedUtc,
    completedUtc: new Date().toISOString(),
    complete: requests.every((row) => row.status === 200),
    productionAuthRequests: 0,
    applicationDatabaseWrites: 0,
    cookiesSent: false,
    bodySent: false,
    requests,
  };
  writeFileSync(args.out, JSON.stringify({ origin: origin.origin, controlled }, null, 2));
  console.log(
    `nonce ${nonce}\ncomplete ${controlled.complete}\nfinished ${controlled.completedUtc}`,
  );
  if (!controlled.complete) process.exitCode = 1;
}

function assemble(args) {
  need(
    args,
    "controlled",
    "log",
    "source-commit",
    "manifest",
    "deployed",
    "checked",
    "internal-port",
    "out-dir",
  );
  const { origin, controlled } = JSON.parse(readFileSync(args.controlled, "utf8"));
  const result = assembleBoundaryProof({
    origin,
    controlled,
    providerLog: readFileSync(args.log, "utf8"),
    sourceCommit: args["source-commit"],
    manifest: args.manifest,
    deployedUtc: args.deployed,
    checkedUtc: args.checked,
    internalPort: args["internal-port"],
  });
  mkdirSync(args["out-dir"], { recursive: true });
  writeFileSync(path.join(args["out-dir"], "boundary-proof.json"), result.raw);
  writeFileSync(path.join(args["out-dir"], "boundary-proof.sha256"), result.sha256);
  console.log(
    `valid for ${origin}\npeer ${result.peer}\nbytes ${Buffer.byteLength(result.raw)}\nsha256 ${result.sha256}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const run = { probe, assemble }[command];
  if (!run) {
    console.error("Usage: ingress-prove.mjs probe|assemble --option value ...");
    process.exit(2);
  }
  try {
    await run(options(rest));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed.");
    process.exit(1);
  }
}
