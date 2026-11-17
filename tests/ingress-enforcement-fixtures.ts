import { createHash } from "node:crypto";

export const origin = "https://fixture.example.invalid";
export const nonce = "013579bd-1234-4123-8123-0123456789ab";
const fingerprint = (ip: string) =>
  createHash("sha256")
    .update(nonce + ip)
    .digest("hex");
const at = (milliseconds: number) =>
  new Date(Date.UTC(2026, 10, 16, 20) + milliseconds).toISOString();

/** Entirely synthetic local test data; never a deployable production boundary proof. */
export function boundaryProof(peer = "127.0.0.1", client = "203.0.113.9") {
  const path = `/api/health/live?ingressProbe=${nonce}`;
  const sourceCommit = "0".repeat(40);
  const variants = [
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
      [
        "Host",
        "fixture.example.invalid",
        "X-Real-IP",
        "198.51.100.9",
        "X-Forwarded-For",
        "198.51.100.10",
      ],
    ],
    [
      "direct-forged-local",
      ["Host", "fixture.example.invalid", "X-Real-IP", "127.0.0.1", "X-Forwarded-For", "10.0.0.1"],
    ],
  ] as const;
  const observation = (rawPeer: string, index: number) => ({
    event: "ahibizz_ingress_observe",
    version: 1,
    nonce,
    pid: 123,
    observationOnly: true,
    trustedForAuthentication: false,
    fingerprintScheme: "sha256(nonce + normalizedIp)",
    observedAt: at(6300 + index * 20),
    peer: {
      valid: true,
      family: 4,
      scope: rawPeer === client ? "public_or_other" : "loopback",
      fingerprint: fingerprint(rawPeer),
      ...(rawPeer === client ? {} : { address: rawPeer }),
    },
    headers: {
      realIp: {
        status: "valid_untrusted_observation",
        fieldCount: 1,
        tokenCount: 1,
        validCount: 1,
        fingerprints: [{ valid: true, fingerprint: fingerprint(client) }],
      },
    },
  });
  const observations = variants.map(([variant], index) => ({
    variant,
    observation: observation(index < 6 ? peer : client, index),
  }));
  const providerLog = observations
    .map(({ observation: event }) => `provider ${JSON.stringify(event)}`)
    .join("\n");
  return {
    schema: 2,
    appId: 213,
    origin,
    operatorReviewed: true,
    observerSourceCommit: sourceCommit,
    deployment: { sourceCommit, manifest: `sha256:${"1".repeat(64)}`, completedUtc: at(-60000) },
    observerProof: {
      appId: 213,
      sourceCommit,
      checkedUtc: at(10000),
      nonce,
      request: { method: "GET", path, status: 200, authCookies: false, bodySent: false },
      observation: observations[0]?.observation,
      observations,
      providerLogSha256: createHash("sha256").update(providerLog).digest("hex"),
      productionAuthRequests: 0,
      applicationDatabaseWrites: 0,
      trustChanged: false,
      canonicalExactPeer: peer,
    },
    controlledRequests: {
      appId: 213,
      sourceCommit,
      nonce,
      path,
      startedUtc: at(0),
      completedUtc: at(200),
      complete: true,
      productionAuthRequests: 0,
      applicationDatabaseWrites: 0,
      cookiesSent: false,
      bodySent: false,
      requests: variants.map(([variant, headers], index) => ({
        variant,
        origin: index < 6 ? origin : "http://192.0.2.100:3000",
        method: "GET",
        path,
        headers: [...headers] as string[],
        attempts: 1,
        state: "completed",
        status: 200,
        authCookies: false,
        bodySent: false,
        dispatchedUtc: at(index * 20),
        completedUtc: at(index * 20 + 10),
      })),
    },
    providerLog,
  };
}

export function refreshBoundaryLog(proof: ReturnType<typeof boundaryProof>) {
  proof.providerLog = proof.observerProof.observations
    .map(({ observation }) => `provider ${JSON.stringify(observation)}`)
    .join("\n");
  proof.observerProof.providerLogSha256 = createHash("sha256")
    .update(proof.providerLog)
    .digest("hex");
}

export function enforcementEnv(internalPort = 43128, proof = boundaryProof()) {
  const raw = JSON.stringify(proof);
  return {
    AHIBIZZ_INGRESS_ENFORCE: "true",
    PORT: "43127",
    AHIBIZZ_NEXT_INTERNAL_PORT: String(internalPort),
    AHIBIZZ_INGRESS_PROXY_PEERS: proof.observerProof.canonicalExactPeer,
    BETTER_AUTH_URL: origin,
    AHIBIZZ_INGRESS_BOUNDARY_PROOF: raw,
    AHIBIZZ_INGRESS_BOUNDARY_SHA256: createHash("sha256").update(raw).digest("hex"),
    AHIBIZZ_INGRESS_TRUST_CLIENT_IP: "false",
  };
}

/** Synthetic future ACL attestation; it is not evidence of this hosting provider's configuration. */
export function syntheticTrustAttestation(env = enforcementEnv()) {
  return {
    schema: 1,
    kind: "app_specific_network_acl",
    appId: 213,
    origin,
    boundarySha256: env.AHIBIZZ_INGRESS_BOUNDARY_SHA256,
    proxyPeers: [env.AHIBIZZ_INGRESS_PROXY_PEERS],
    reviewed: true,
    reviewedUtc: at(10000),
    providerEvidence: {
      url: "https://provider.example.invalid/support/app-213",
      appId: 213,
      appSpecific: true,
      untrustedHostOrTenantReachabilityBlocked: true,
      authorizedProxyOnly: true,
      captureSha256: "2".repeat(64),
    },
    scope: "app_specific_boundary",
    nginxProcessAuthentication: false,
  };
}

export function trustedEnforcementEnv(internalPort = 43128, proof = boundaryProof()) {
  const env = enforcementEnv(internalPort, proof);
  const raw = JSON.stringify(syntheticTrustAttestation(env));
  return {
    ...env,
    AHIBIZZ_INGRESS_TRUST_CLIENT_IP: "true",
    AHIBIZZ_INGRESS_TRUST_ATTESTATION: raw,
    AHIBIZZ_INGRESS_TRUST_ATTESTATION_SHA256: createHash("sha256").update(raw).digest("hex"),
  };
}
