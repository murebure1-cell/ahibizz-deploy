import { createHash } from "node:crypto";
import { isIP } from "node:net";

const variants = [
  "canonical-base",
  "canonical-spoof-real-one",
  "canonical-spoof-real-two",
  "canonical-spoof-chain",
  "canonical-duplicate-real",
  "canonical-duplicate-forwarded",
  "direct-base",
  "direct-forged-host",
  "direct-forged-local",
];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const invalid = () => {
  throw new Error("Invalid or unproved ingress enforcement configuration.");
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function normalizeIngressIp(value) {
  if (typeof value !== "string" || value.length > 64 || value.includes("%")) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
}

const fingerprint = (nonce, ip) => digest(nonce + ip);
const time = (value) => {
  const result = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(result)) invalid();
  return result;
};

function realIpFingerprint(value) {
  const field = value.headers?.realIp;
  if (
    field?.status !== "valid_untrusted_observation" ||
    field.fieldCount !== 1 ||
    field.tokenCount !== 1 ||
    field.validCount !== 1 ||
    field.fingerprints?.length !== 1 ||
    field.fingerprints[0]?.valid !== true ||
    !isDigest(field.fingerprints[0].fingerprint)
  )
    invalid();
  return field.fingerprints[0].fingerprint;
}

function requestHeaders(row, canonicalHost, nonce, clientFingerprint) {
  const expected = {
    "canonical-base": [],
    "canonical-spoof-real-one": ["x-real-ip"],
    "canonical-spoof-real-two": ["x-real-ip"],
    "canonical-spoof-chain": ["x-real-ip", "x-forwarded-for"],
    "canonical-duplicate-real": ["x-real-ip", "x-real-ip"],
    "canonical-duplicate-forwarded": ["x-forwarded-for", "x-forwarded-for"],
    "direct-base": [],
    "direct-forged-host": ["host", "x-real-ip", "x-forwarded-for"],
    "direct-forged-local": ["host", "x-real-ip", "x-forwarded-for"],
  }[row.variant];
  if (!Array.isArray(row.headers) || row.headers.length !== expected.length * 2) invalid();
  for (let index = 0; index < expected.length; index++) {
    const key = row.headers[index * 2];
    const value = row.headers[index * 2 + 1];
    if (typeof key !== "string" || key.toLowerCase() !== expected[index]) invalid();
    if (key.toLowerCase() === "host") {
      if (value !== canonicalHost) invalid();
      continue;
    }
    if (typeof value !== "string" || value.length > 256) invalid();
    const parts = value.split(",");
    if (key.toLowerCase() === "x-real-ip" && parts.length !== 1) invalid();
    if (key.toLowerCase() === "x-forwarded-for" && parts.length > 2) invalid();
    for (const part of parts) {
      const ip = normalizeIngressIp(part.trim());
      if (!ip || fingerprint(nonce, ip) === clientFingerprint) invalid();
    }
  }
}

/** Validates the complete operator-reviewed nine-request phase1 bundle, never caller headers. */
export function validateIngressBoundary(raw, expectedDigest, origin, peers) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 65_536 || !isDigest(expectedDigest))
    invalid();
  if (digest(raw) !== expectedDigest) invalid();
  let proof;
  try {
    proof = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (
    proof?.schema !== 2 ||
    proof.appId !== 213 ||
    proof.origin !== origin ||
    proof.operatorReviewed !== true ||
    peers.length !== 1 ||
    !/^[a-f0-9]{40}$/.test(proof.observerSourceCommit ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(proof.deployment?.manifest ?? "") ||
    proof.deployment.sourceCommit !== proof.observerSourceCommit
  )
    invalid();
  const observed = proof.observerProof;
  const controlled = proof.controlledRequests;
  const nonce = observed?.nonce;
  const requestPath = `/api/health/live?ingressProbe=${nonce}`;
  if (
    !uuid.test(nonce ?? "") ||
    observed.appId !== 213 ||
    controlled?.appId !== 213 ||
    observed.sourceCommit !== proof.observerSourceCommit ||
    controlled.sourceCommit !== proof.observerSourceCommit ||
    controlled.nonce !== nonce ||
    controlled.path !== requestPath ||
    controlled.complete !== true ||
    controlled.productionAuthRequests !== 0 ||
    controlled.applicationDatabaseWrites !== 0 ||
    controlled.cookiesSent !== false ||
    controlled.bodySent !== false ||
    observed.productionAuthRequests !== 0 ||
    observed.applicationDatabaseWrites !== 0 ||
    observed.trustChanged !== false ||
    observed.request?.method !== "GET" ||
    observed.request.path !== requestPath ||
    observed.request.status !== 200 ||
    observed.request.authCookies !== false ||
    observed.request.bodySent !== false ||
    !Array.isArray(controlled.requests) ||
    controlled.requests.length !== 9 ||
    !Array.isArray(observed.observations) ||
    observed.observations.length !== 9 ||
    typeof proof.providerLog !== "string" ||
    Buffer.byteLength(proof.providerLog) > 32_768 ||
    digest(proof.providerLog) !== observed.providerLogSha256
  )
    invalid();
  const deployedAt = time(proof.deployment.completedUtc);
  const startedAt = time(controlled.startedUtc);
  const completedAt = time(controlled.completedUtc);
  const checkedAt = time(observed.checkedUtc);
  if (startedAt < deployedAt || completedAt < startedAt || checkedAt < completedAt) invalid();
  if (completedAt - startedAt > 120_000 || checkedAt - completedAt > 300_000) invalid();
  const peerFingerprint = fingerprint(nonce, peers[0]);
  const first = observed.observations[0]?.observation;
  const clientFingerprint = realIpFingerprint(first);
  const rawEvents = [];
  for (const line of proof.providerLog.split(/\r?\n/)) {
    const index = line.indexOf("{");
    if (index < 0) continue;
    try {
      const event = JSON.parse(line.slice(index));
      if (event.event === "ahibizz_ingress_observe" && event.nonce === nonce) rawEvents.push(event);
    } catch {
      // Unrelated provider lines are not evidence and are never used as authority.
    }
  }
  if (rawEvents.length !== 9) invalid();
  let priorRequestAt = startedAt;
  let priorObservedAt = startedAt - 30_000;
  let directOrigin;
  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index];
    const row = controlled.requests[index];
    const entry = observed.observations[index];
    const event = entry?.observation;
    if (
      row?.variant !== variant ||
      entry.variant !== variant ||
      row.method !== "GET" ||
      row.path !== requestPath ||
      row.attempts !== 1 ||
      row.state !== "completed" ||
      row.status !== 200 ||
      row.authCookies !== false ||
      row.bodySent !== false ||
      event?.event !== "ahibizz_ingress_observe" ||
      event.version !== 1 ||
      event.nonce !== nonce ||
      event.observationOnly !== true ||
      event.trustedForAuthentication !== false ||
      event.fingerprintScheme !== "sha256(nonce + normalizedIp)" ||
      event.peer?.valid !== true ||
      !isDigest(event.peer.fingerprint) ||
      !Number.isSafeInteger(event.pid) ||
      event.pid !== first.pid ||
      JSON.stringify(event) !== JSON.stringify(rawEvents[index])
    )
      invalid();
    const dispatchedAt = time(row.dispatchedUtc);
    const responseAt = time(row.completedUtc);
    const observationAt = time(event.observedAt);
    if (
      dispatchedAt < priorRequestAt ||
      responseAt < dispatchedAt ||
      responseAt > completedAt ||
      observationAt < priorObservedAt ||
      observationAt < dispatchedAt - 30_000 ||
      observationAt > responseAt + 30_000 ||
      observationAt > checkedAt
    )
      invalid();
    priorRequestAt = responseAt;
    priorObservedAt = observationAt;
    requestHeaders(row, new URL(origin).host, nonce, clientFingerprint);
    if (index < 6) {
      if (
        row.origin !== origin ||
        event.peer.fingerprint !== peerFingerprint ||
        normalizeIngressIp(event.peer.address) !== peers[0] ||
        !["private", "loopback"].includes(event.peer.scope) ||
        realIpFingerprint(event) !== clientFingerprint
      )
        invalid();
    } else {
      let url;
      try {
        url = new URL(row.origin);
      } catch {
        invalid();
      }
      if (
        url.protocol !== "http:" ||
        !normalizeIngressIp(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        event.peer.scope !== "public_or_other" ||
        event.peer.address !== undefined ||
        event.peer.fingerprint === peerFingerprint ||
        event.peer.fingerprint !== clientFingerprint ||
        (directOrigin !== undefined && directOrigin !== row.origin)
      )
        invalid();
      directOrigin = row.origin;
    }
  }
  if (JSON.stringify(observed.observation) !== JSON.stringify(first)) invalid();
}
