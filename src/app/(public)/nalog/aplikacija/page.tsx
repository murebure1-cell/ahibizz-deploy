import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSignIn } from "../../../../components/auth/AppSignIn";
import { appHandoffPagePath, readAppHandoff } from "../../../../lib/app-handoff";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../../server/auth/accounts";
import { administrationAccount } from "../../../../server/auth/app-handoff";
import { getAuthDatabasePool } from "../../../../server/auth/service";
import { titled } from "../../../../server/i18n";

export const dynamic = "force-dynamic";
// No referrer policy of its own: with "no-referrer" a browser sends "Origin: null" with the
// confirmation form, and the form is refused (seen live on 2026-11-27).
export const generateMetadata = titled("Prijava u aplikaciju", {
  robots: { index: false, follow: false },
});

/**
 * The app's "Nastavi s Googleom" opens this page in the browser. A signed-out visitor signs in
 * first (Google included) and comes back here; a signed-in one confirms, and the browser hands the
 * app a one-time code (lib/app-handoff.ts).
 */
export default async function AppSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    for (const item of [value].flat()) if (typeof item === "string") params.append(key, item);
  const failures = params.getAll("greska");
  const handoff = readAppHandoff(params, ["greska"]);
  if (!handoff || failures.length > 1) return <AppSignIn view={{ kind: "invalid" }} />;
  const path = appHandoffPagePath(handoff);
  const service = getAccountService();
  let account: SafeAccountProfile | null = null;
  let signedOut = false;
  try {
    if (service) account = await service.read(await headers());
  } catch (error) {
    signedOut = error instanceof AccountAccessError && error.status === 401;
  }
  if (signedOut) redirect(`/prijava?nastavi=${encodeURIComponent(path)}`);
  if (!account) return <AppSignIn view={{ kind: "unavailable" }} />;
  const pool = getAuthDatabasePool();
  if (!pool) return <AppSignIn view={{ kind: "unavailable" }} />;
  let administration: boolean;
  try {
    administration = await administrationAccount(pool, account.id);
  } catch {
    return <AppSignIn view={{ kind: "unavailable" }} />;
  }
  if (administration) return <AppSignIn view={{ kind: "refused", path }} />;
  return (
    <AppSignIn
      view={{
        kind: "confirm",
        ...handoff,
        path,
        account: { id: account.id, name: account.name, email: account.email },
        failure: failures[0],
      }}
    />
  );
}
