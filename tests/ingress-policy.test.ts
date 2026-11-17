import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  boundaryProof,
  enforcementEnv,
  origin,
  refreshBoundaryLog,
  type syntheticTrustAttestation,
  trustedEnforcementEnv,
} from "./ingress-enforcement-fixtures";

const lib = await import(new URL("../scripts/ingress-policy.mjs", import.meta.url).href);
function entry<T>(rows: T[], index: number): T {
  const value = rows[index];
  assert.ok(value);
  return value;
}

test("enforcement defaults off, accepts no broad peer ranges and requires a bound reviewed proof", () => {
  assert.equal(lib.readIngressEnforcementPolicy({}), null);
  assert.equal(lib.readIngressEnforcementPolicy({ AHIBIZZ_INGRESS_ENFORCE: "false" }), null);
  for (const changes of [
    { AHIBIZZ_INGRESS_ENFORCE: "TRUE" },
    { AHIBIZZ_NEXT_INTERNAL_PORT: "43127" },
    { AHIBIZZ_NEXT_INTERNAL_PORT: "0" },
    { AHIBIZZ_INGRESS_PROXY_PEERS: "127.0.0.0/8" },
    { AHIBIZZ_INGRESS_PROXY_PEERS: "localhost" },
    { AHIBIZZ_INGRESS_PROXY_PEERS: "127.0.0.1,::ffff:127.0.0.1" },
    { AHIBIZZ_INGRESS_PROXY_PEERS: "127.0.0.1,127.0.0.2" },
    { AHIBIZZ_INGRESS_BOUNDARY_SHA256: "0".repeat(64) },
    { AHIBIZZ_INGRESS_BOUNDARY_PROOF: "{}" },
    { BETTER_AUTH_URL: "http://fixture.example.invalid" },
    { BETTER_AUTH_URL: `${origin}/other` },
    { BETTER_AUTH_URL: `${origin}?token=other` },
  ])
    assert.throws(() => lib.readIngressEnforcementPolicy({ ...enforcementEnv(), ...changes }));
  const policy = lib.readIngressEnforcementPolicy(enforcementEnv());
  assert.equal(policy.internalHost, "127.0.0.1");
  assert.equal(policy.trustClientIp, false);
  assert.deepEqual(policy.peers, ["127.0.0.1"]);
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.peers));
  assert.equal(lib.isValidatedIngressPolicy({ ...policy }), false);
});

test("client-IP trust requires a separate app-specific ACL review and never follows the shared gateway alone", () => {
  const trusted = trustedEnforcementEnv();
  assert.equal(lib.readIngressEnforcementPolicy(trusted).trustClientIp, true);
  for (const changed of [
    { AHIBIZZ_INGRESS_TRUST_CLIENT_IP: "TRUE" },
    { AHIBIZZ_INGRESS_TRUST_ATTESTATION: undefined },
    { AHIBIZZ_INGRESS_TRUST_ATTESTATION_SHA256: "0".repeat(64) },
    { AHIBIZZ_INGRESS_ENFORCE: "false" },
  ])
    assert.throws(() => lib.readIngressEnforcementPolicy({ ...trusted, ...changed }));
  assert.throws(() =>
    lib.readIngressEnforcementPolicy({
      ...enforcementEnv(),
      AHIBIZZ_INGRESS_TRUST_CLIENT_IP: "true",
    }),
  );
  const mutations: ((proof: ReturnType<typeof syntheticTrustAttestation>) => void)[] = [
    (p) => {
      p.kind = "published_provider_isolation_contract";
    },
    (p) => {
      p.kind = "authenticated_proxy_marker";
    },
    (p) => {
      p.appId = 212;
    },
    (p) => {
      p.origin = "https://other.example.invalid";
    },
    (p) => {
      p.boundarySha256 = "0".repeat(64);
    },
    (p) => {
      p.proxyPeers = ["127.0.0.2"];
    },
    (p) => {
      p.reviewed = false;
    },
    (p) => {
      p.reviewedUtc = "invalid";
    },
    (p) => {
      p.providerEvidence.appId = 212;
    },
    (p) => {
      p.providerEvidence.appSpecific = false;
    },
    (p) => {
      p.providerEvidence.untrustedHostOrTenantReachabilityBlocked = false;
    },
    (p) => {
      p.providerEvidence.authorizedProxyOnly = false;
    },
    (p) => {
      p.providerEvidence.captureSha256 = "unknown";
    },
    (p) => {
      p.providerEvidence.url = "http://provider.example.invalid/acl";
    },
    (p) => {
      p.providerEvidence.url = "https://user:secret@provider.example.invalid/acl";
    },
    (p) => {
      p.scope = "general_provider_contract_not_app_specific_acl";
    },
    (p) => {
      p.nginxProcessAuthentication = true;
    },
  ];
  for (const mutate of mutations) {
    const proof = JSON.parse(trusted.AHIBIZZ_INGRESS_TRUST_ATTESTATION);
    mutate(proof);
    const raw = JSON.stringify(proof);
    assert.throws(() =>
      lib.readIngressEnforcementPolicy({
        ...trusted,
        AHIBIZZ_INGRESS_TRUST_ATTESTATION: raw,
        AHIBIZZ_INGRESS_TRUST_ATTESTATION_SHA256: createHash("sha256").update(raw).digest("hex"),
      }),
    );
  }
});

test("one valid proxy Host is discarded while malformed, missing or duplicate Host remains rejected", () => {
  const policy = lib.readIngressEnforcementPolicy(enforcementEnv());
  const request = (fields: string[], peer = "127.0.0.1") => ({
    socket: { remoteAddress: peer },
    rawHeaders: [...fields, "X-Real-IP", "203.0.113.9"],
    url: "/",
    method: "GET",
  });
  for (const host of [
    "fixture.example.invalid",
    "FIXTURE.EXAMPLE.INVALID",
    "127.0.0.1:43127",
    "container-name:43127",
    "container_name:43127",
    "[::1]:43127",
    "[2001:DB8::1]:443",
    "fixture.example.invalid:443",
    "fixture.example.invalid:00080",
  ])
    assert.equal(lib.inspectIngressRequest(request(["Host", host]), policy).allowed, true, host);
  for (const host of [
    "",
    "https://fixture.invalid",
    "fixture.invalid/path",
    "user@fixture.invalid",
    "fixture.invalid?x=1",
    "fixture.invalid#x",
    "*.fixture.invalid",
    "fixture.invalid,other.invalid",
    " fixture.invalid",
    "fixture.invalid ",
    "fixture.invalid:0",
    "fixture.invalid:65536",
    "fixture.invalid:",
    "fixture.invalid:abc",
    "foo..invalid",
    "a".repeat(261),
    "::1",
  ])
    assert.equal(lib.inspectIngressRequest(request(["Host", host]), policy).status, 400, host);
  assert.equal(lib.inspectIngressRequest(request([]), policy).status, 400);
  assert.equal(
    lib.inspectIngressRequest(request(["Host", "fixture.invalid", "Host", "other.invalid"]), policy)
      .status,
    400,
  );
  assert.equal(
    lib.inspectIngressRequest(request(["Host", "127.0.0.1:43127"], "203.0.113.9"), policy).status,
    403,
  );
  assert.equal(policy.origin, origin);
  assert.equal(policy.trustClientIp, false);
});

test("nine observed requests, source, raw digest, status and bounded clock offset are mandatory", () => {
  const mutations: ((proof: ReturnType<typeof boundaryProof>) => void)[] = [
    (p) => {
      entry(p.observerProof.observations, 6).observation = entry(
        p.observerProof.observations,
        0,
      ).observation;
    },
    (p) => {
      entry(p.observerProof.observations, 6).observation.peer.fingerprint = "f".repeat(64);
    },
    (p) => {
      entry(p.observerProof.observations, 1).observation.headers.realIp.fieldCount = 2;
    },
    (p) => {
      entry(
        entry(p.observerProof.observations, 4).observation.headers.realIp.fingerprints,
        0,
      ).fingerprint = "f".repeat(64);
    },
    (p) => {
      p.operatorReviewed = false;
    },
    (p) => {
      entry(p.controlledRequests.requests, 1).headers[1] = "203.0.113.9";
    },
    (p) => {
      p.origin = "https://other.example.invalid";
    },
    (p) => {
      entry(p.controlledRequests.requests, 1).status = 500;
    },
    (p) => {
      entry(p.controlledRequests.requests, 1).attempts = 2;
    },
    (p) => {
      p.controlledRequests.sourceCommit = "f".repeat(40);
    },
    (p) => {
      p.deployment.sourceCommit = "f".repeat(40);
    },
    (p) => {
      p.observerProof.observations.pop();
    },
    (p) => {
      entry(p.controlledRequests.requests, 0).bodySent = true;
    },
    (p) => {
      entry(p.observerProof.observations, 0).observation.observedAt = "2026-11-16T20:01:00.000Z";
    },
  ];
  for (const change of mutations) {
    const proof = boundaryProof();
    change(proof);
    refreshBoundaryLog(proof);
    assert.throws(() => lib.readIngressEnforcementPolicy(enforcementEnv(43128, proof)));
  }
  const proof = boundaryProof();
  proof.providerLog += "changed";
  assert.throws(() => lib.readIngressEnforcementPolicy(enforcementEnv(43128, proof)));
  assert.ok(
    lib.readIngressEnforcementPolicy(enforcementEnv()),
    "6.3second provider clock offset is bounded and accepted",
  );
});

test("only explicit loopback health paths bypass a client-address requirement", () => {
  const policy = lib.readIngressEnforcementPolicy(enforcementEnv());
  const request = (peer: string, url: string, method = "GET", fields: string[] = []) => ({
    socket: { remoteAddress: peer },
    rawHeaders: ["Host", "fixture.example.invalid", ...fields],
    url,
    method,
  });
  for (const url of ["/api/health/live", "/api/health/ready"])
    assert.equal(lib.inspectIngressRequest(request("127.0.0.2", url), policy).health, true);
  for (const [peer, url, method] of [
    ["127.0.0.2", "/", "GET"],
    ["127.0.0.2", "/api/health/live?x=1", "GET"],
    ["127.0.0.2", "/api/health/ready", "POST"],
    ["203.0.113.9", "/api/health/live", "GET"],
    ["127.0.0.1", "/", "GET"],
  ] as const)
    assert.equal(lib.inspectIngressRequest(request(peer, url, method), policy).allowed, false);
  const good = request("::ffff:127.0.0.1", "/api/account", "GET", [
    "X-Real-IP",
    "::ffff:203.0.113.9",
  ]);
  assert.equal(lib.inspectIngressRequest(good, policy).clientIp, "203.0.113.9");
  for (const fields of [
    ["X-Real-IP", "203.0.113.9", "x-real-ip", "198.51.100.9"],
    ["X-Real-IP", "203.0.113.9, 198.51.100.9"],
    ["X-Real-IP", "not-an-ip"],
    ["X-Forwarded-For", "203.0.113.9"],
  ])
    assert.equal(
      lib.inspectIngressRequest(request("127.0.0.1", "/", "GET", fields), policy).allowed,
      false,
    );
});
