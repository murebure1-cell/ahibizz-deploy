import { accountReturnPath } from "./account-return";

/** Keep only the existing destination allowlist across registration and email confirmation. */
export function authReturnLinks(value: unknown): {
  login: string;
  registration: string;
  verification: string;
} {
  const destination = accountReturnPath(value);
  const continuation = new URLSearchParams();
  const verification = new URLSearchParams({ potvrdeno: "1" });
  if (destination !== "/nalog") {
    continuation.set("nastavi", destination);
    verification.set("nastavi", destination);
  }
  const suffix = continuation.size ? `?${continuation}` : "";
  return {
    login: `/prijava${suffix}`,
    registration: `/registracija${suffix}`,
    verification: `/prijava?${verification}`,
  };
}
