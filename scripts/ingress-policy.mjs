import { createHash } from "node:crypto";
import { normalizeIngressIp, validateIngressBoundary } from "./ingress-evidence.mjs";

export { normalizeIngressIp } from "./ingress-evidence.mjs";
export const internalClientIpHeader = "x-ahibizz-ingress-client-ip";
const validatedPolicies = new WeakSet();
const invalid = () => {
  throw new Error("Invalid or unproved ingress enforcement configuration.");
};

function port(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) invalid();
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) invalid();
  return number;
}

function hostAuthority(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 260 ||
    !/^[a-zA-Z0-9_.:[\]-]+$/.test(value)
  )
    return null;
  try {
    const parts = value.startsWith("[")
      ? /^\[([a-fA-F0-9:.]+)\](?::([0-9]+))?$/.exec(value)
      : /^([a-zA-Z0-9_.-]+)(?::([0-9]+))?$/.exec(value);
    if (!parts || (parts[2] && (Number(parts[2]) < 1 || Number(parts[2]) > 65535))) return null;
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (
      !value.startsWith("[") &&
      parts[1]
        .replace(/\.$/, "")
        .split(".")
        .some((label) => !/^[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?$/.test(label))
    )
      return null;
    return url.host;
  } catch {
    return null;
  }
}

/** Default-off, server-owned policy; invalid enabled configurations fail closed. */
export function readIngressEnforcementPolicy(env = process.env) {
  if (env.AHIBIZZ_INGRESS_ENFORCE === undefined || env.AHIBIZZ_INGRESS_ENFORCE === "false") {
    if (
      env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP !== undefined &&
      env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP !== "false"
    )
      invalid();
    return null;
  }
  if (env.AHIBIZZ_INGRESS_ENFORCE !== "true") invalid();
  const publicPort = port(env.PORT);
  const internalPort = port(env.AHIBIZZ_NEXT_INTERNAL_PORT);
  if (publicPort === internalPort) invalid();
  let origin;
  try {
    const raw = env.BETTER_AUTH_URL;
    const url = new URL(raw);
    if (
      typeof raw !== "string" ||
      raw !== raw.trim() ||
      /[\r\n\t]/.test(raw) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      invalid();
    origin = url.origin;
  } catch {
    invalid();
  }
  const rawPeers = env.AHIBIZZ_INGRESS_PROXY_PEERS;
  if (typeof rawPeers !== "string" || rawPeers.length > 600) invalid();
  const peers = rawPeers.split(",").map((peer) => normalizeIngressIp(peer.trim()));
  if (!peers.length || peers.length > 8 || peers.some((peer) => !peer)) invalid();
  if (new Set(peers).size !== peers.length) invalid();
  validateIngressBoundary(
    env.AHIBIZZ_INGRESS_BOUNDARY_PROOF,
    env.AHIBIZZ_INGRESS_BOUNDARY_SHA256,
    origin,
    peers,
  );
  const policy = {
    enabled: true,
    publicPort,
    internalPort,
    internalHost: "127.0.0.1",
    origin,
    peers: Object.freeze(peers),
    boundarySha256: env.AHIBIZZ_INGRESS_BOUNDARY_SHA256,
    trustClientIp: false,
  };
  validatedPolicies.add(policy);
  policy.trustClientIp = readIngressClientIpTrust(env, policy);
  return Object.freeze(policy);
}

export const isValidatedIngressPolicy = (policy) => validatedPolicies.has(policy);

/** A shared gateway probe or general provider contract is not an app-specific isolation proof. */
export function readIngressClientIpTrust(env, policy) {
  if (
    env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP === undefined ||
    env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP === "false"
  )
    return false;
  if (env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP !== "true" || !isValidatedIngressPolicy(policy))
    invalid();
  const raw = env.AHIBIZZ_INGRESS_TRUST_ATTESTATION;
  const sha = env.AHIBIZZ_INGRESS_TRUST_ATTESTATION_SHA256;
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw) > 8192 ||
    !/^[a-f0-9]{64}$/.test(sha ?? "") ||
    createHash("sha256").update(raw).digest("hex") !== sha
  )
    invalid();
  let proof;
  try {
    proof = JSON.parse(raw);
    const url = new URL(proof.providerEvidence?.url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      invalid();
  } catch {
    invalid();
  }
  if (
    proof?.schema !== 1 ||
    proof.kind !== "app_specific_network_acl" ||
    proof.appId !== 213 ||
    proof.origin !== policy.origin ||
    proof.boundarySha256 !== policy.boundarySha256 ||
    JSON.stringify(proof.proxyPeers) !== JSON.stringify(policy.peers) ||
    proof.reviewed !== true ||
    !Number.isFinite(Date.parse(proof.reviewedUtc)) ||
    proof.providerEvidence.appId !== 213 ||
    proof.providerEvidence.appSpecific !== true ||
    proof.providerEvidence.untrustedHostOrTenantReachabilityBlocked !== true ||
    proof.providerEvidence.authorizedProxyOnly !== true ||
    !/^[a-f0-9]{64}$/.test(proof.providerEvidence.captureSha256 ?? "") ||
    proof.scope !== "app_specific_boundary" ||
    proof.nginxProcessAuthentication !== false
  )
    invalid();
  return true;
}

function singleRawHeader(request, name) {
  const values = [];
  for (let index = 0; index + 1 < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index].toLowerCase() === name)
      values.push(request.rawHeaders[index + 1]);
  return values.length === 1 ? values[0] : null;
}

export function inspectIngressRequest(request, policy) {
  if (!isValidatedIngressPolicy(policy)) invalid();
  const peer = normalizeIngressIp(request.socket.remoteAddress);
  const proxy = peer && policy.peers.includes(peer);
  const loopback = peer === "::1" || peer?.startsWith("127.");
  const health =
    request.method === "GET" && ["/api/health/live", "/api/health/ready"].includes(request.url);
  if (health && loopback) return { allowed: true, health: true, clientIp: null };
  if (!proxy) return { allowed: false, status: 403 };
  if (
    typeof request.url !== "string" ||
    request.url.length > 8192 ||
    !request.url.startsWith("/") ||
    request.url.startsWith("//") ||
    /[^\x21-\x7e]|#/.test(request.url)
  )
    return { allowed: false, status: 400 };
  const host = hostAuthority(singleRawHeader(request, "host"));
  // Discard the incoming authority. The fixed origin is reconstructed by the
  // forwarder; Host never selects an upstream, auth origin or client-IP trust.
  if (!host) return { allowed: false, status: 400 };
  const supplied = singleRawHeader(request, "x-real-ip");
  const clientIp = normalizeIngressIp(supplied?.trim());
  if (!clientIp) return { allowed: false, status: 400 };
  // The one alias people type by habit. The destination is the configured origin and the already
  // validated path, so the caller's Host still chooses nothing but whether to be sent there.
  if (host.replace(/:(?:80|443)$/, "") === `www.${new URL(policy.origin).host}`)
    return { allowed: true, health: false, clientIp, redirect: `${policy.origin}${request.url}` };
  return { allowed: true, health: false, clientIp };
}
