export const proofVariants: readonly (readonly [string, readonly (string | null)[]])[];
export function assembleBoundaryProof(input: {
  origin: string;
  controlled: {
    nonce: string;
    path: string;
    requests: readonly { origin: string }[];
    [key: string]: unknown;
  };
  providerLog: string;
  sourceCommit: string;
  manifest: string;
  deployedUtc: string;
  checkedUtc: string;
  internalPort: number | string;
}): { raw: string; sha256: string; peer: string };
