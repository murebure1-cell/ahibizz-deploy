import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assembleBoundaryProof, proofVariants } from "../scripts/ingress-prove.mjs";

const origin = "https://prove.example.invalid";
const direct = "http://192.0.2.100:3000";
const nonce = "2468ace0-1357-4abc-9def-0123456789ab";
const path = `/api/health/live?ingressProbe=${nonce}`;
const sourceCommit = "a".repeat(40);
const manifest = `sha256:${"b".repeat(64)}`;
const at = (milliseconds: number) =>
  new Date(Date.UTC(2026, 10, 25, 7) + milliseconds).toISOString();
const fingerprint = (ip: string) =>
  createHash("sha256")
    .update(nonce + ip)
    .digest("hex");

/** Entirely synthetic measurements; never a deployable production boundary proof. */
function measurements(peer = "10.0.0.5", client = "203.0.113.9") {
  const requests = proofVariants.map(([variant, template], index) => ({
    variant,
    origin: index < 6 ? origin : direct,
    method: "GET",
    path,
    headers: template.map((value) => (value === null ? new URL(origin).host : value)),
    attempts: 1,
    state: "completed",
    status: 200,
    authCookies: false,
    bodySent: false,
    dispatchedUtc: at(index * 300),
    completedUtc: at(index * 300 + 120),
  }));
  const address = {
    valid: true,
    family: 4,
    scope: "public_or_other",
    fingerprint: fingerprint(client),
  };
  const lines = requests.map((row, index) => {
    const event = {
      event: "ahibizz_ingress_observe",
      version: 1,
      observedAt: at(index * 300 + 40),
      pid: 25,
      nonce,
      observationOnly: true,
      trustedForAuthentication: false,
      fingerprintScheme: "sha256(nonce + normalizedIp)",
      peer:
        index < 6
          ? {
              valid: true,
              family: 4,
              scope: "private",
              fingerprint: fingerprint(peer),
              address: peer,
            }
          : address,
      headers: {
        realIp: {
          fieldCount: 1,
          tokenCount: 1,
          validCount: 1,
          fingerprints: [address],
          status: "valid_untrusted_observation",
        },
      },
    };
    return `${row.dispatchedUtc} ${JSON.stringify(event)}`;
  });
  return {
    origin,
    controlled: {
      appId: 213,
      nonce,
      path,
      startedUtc: at(0),
      completedUtc: at(3000),
      complete: true,
      productionAuthRequests: 0,
      applicationDatabaseWrites: 0,
      cookiesSent: false,
      bodySent: false,
      requests,
    },
    providerLog: ["an unrelated provider line", ...lines, "a broken { line"].join("\r\n"),
    sourceCommit,
    manifest,
    deployedUtc: at(-60_000),
    checkedUtc: at(20_000),
    internalPort: 3001,
  };
}

test("measurements assemble into a proof the production policy reader accepts", () => {
  const result = assembleBoundaryProof(measurements());
  assert.equal(result.peer, "10.0.0.5");
  assert.equal(result.sha256, createHash("sha256").update(result.raw).digest("hex"));
  assert.equal(/[\r\n]/.test(result.raw), false);
  const proof = JSON.parse(result.raw);
  assert.equal(proof.origin, origin);
  assert.equal(proof.observerProof.observations.length, 9);
  assert.equal(proof.controlledRequests.sourceCommit, sourceCommit);
  assert.equal(proof.providerLog.includes("\r"), false);
});

test("missing lines, a late check, a shared gateway peer and a failed request are refused", () => {
  const missing = measurements();
  missing.providerLog = missing.providerLog.split("\r\n").slice(0, 8).join("\n");
  assert.throws(() => assembleBoundaryProof(missing), /found 7/);

  const late = measurements();
  late.checkedUtc = at(3000 + 300_001);
  assert.throws(() => assembleBoundaryProof(late));

  // A direct request that still arrives from the gateway address proves no boundary.
  assert.throws(() => assembleBoundaryProof(measurements("10.0.0.5", "10.0.0.5")));

  const failed = measurements();
  const first = failed.controlled.requests[0];
  assert.ok(first);
  first.status = 502;
  assert.throws(() => assembleBoundaryProof(failed));
});
