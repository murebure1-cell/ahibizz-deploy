export type IngressPolicy = Readonly<{
  enabled: true;
  publicPort: number;
  internalPort: number;
  internalHost: "127.0.0.1";
  origin: string;
  peers: readonly string[];
  boundarySha256: string;
  trustClientIp: boolean;
}>;
export const internalClientIpHeader: "x-ahibizz-ingress-client-ip";
export function readIngressEnforcementPolicy(
  env?: Readonly<Record<string, string | undefined>>,
): IngressPolicy | null;
export function isValidatedIngressPolicy(value: unknown): value is IngressPolicy;
export function readIngressClientIpTrust(
  env: Readonly<Record<string, string | undefined>>,
  policy: IngressPolicy,
): boolean;
export function normalizeIngressIp(value: unknown): string | null;
