import {
  internalClientIpHeader,
  readIngressClientIpTrust,
  readIngressEnforcementPolicy,
} from "../../../scripts/ingress-policy.mjs";
import type { Environment } from "../env";

export type AuthIngressConfiguration = Readonly<{
  ipAddressHeaders: readonly string[];
}>;
const validated = new WeakSet<AuthIngressConfiguration>();

/** Server configuration only. The public listener must never expose the private Next port. */
export function readAuthIngressConfiguration(
  env: Environment,
  origin: string,
): AuthIngressConfiguration | null {
  if (
    env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP === undefined ||
    env.AHIBIZZ_INGRESS_TRUST_CLIENT_IP === "false"
  )
    return null;
  if (
    env.NODE_ENV !== "production" ||
    env.AHIBIZZ_INGRESS_WRAPPED !== "true" ||
    env.HOSTNAME !== "127.0.0.1" ||
    env.PORT !== env.AHIBIZZ_NEXT_INTERNAL_PORT
  )
    throw new Error("Invalid ingress authentication configuration.");
  const policy = readIngressEnforcementPolicy({ ...env, PORT: env.AHIBIZZ_INGRESS_PUBLIC_PORT });
  if (!policy || policy.origin !== origin || !readIngressClientIpTrust(env, policy))
    throw new Error("Invalid ingress authentication configuration.");
  const configuration = Object.freeze({
    ipAddressHeaders: Object.freeze([internalClientIpHeader]),
  });
  validated.add(configuration);
  return configuration;
}

export function authIpAddressHeaders(configuration?: AuthIngressConfiguration | null): string[] {
  if (configuration == null) return [];
  if (!validated.has(configuration))
    throw new Error("Invalid ingress authentication configuration.");
  return [...configuration.ipAddressHeaders];
}
