import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminSignIn } from "../../../components/admin/AdminSignIn";
import { AuthForm } from "../../../components/auth/AuthForm";
import { accountReturnPath } from "../../../lib/account-return";
import { signedInReturnPath } from "../../../lib/session-navigation";
import { getAccountService } from "../../../server/auth/accounts";
import { authenticationAvailable, googleSignInAvailable } from "../../../server/auth-availability";
import { titled } from "../../../server/i18n";
export const dynamic = "force-dynamic";
export const generateMetadata = titled("Prijava");
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    potvrdeno?: string;
    error?: string;
    google?: string;
    nastavi?: string | string[];
    dodaj?: string;
    administracija?: string;
  }>;
}) {
  const params = await searchParams;
  let destination: string | null = null;
  try {
    const service = getAccountService();
    if (service)
      destination = signedInReturnPath(await service.read(await headers()), params.nastavi);
  } catch {
    // An absent, denied or unavailable session leaves the ordinary sign-in form available.
  }
  // "Dodaj nalog": a signed-in person signs in a second account beside the first.
  const addAccount = params.dodaj === "1" && destination !== null;
  // The administration's own sign-in (AdminUlaz); beside a signed-in account it adds itself.
  if (params.administracija === "1") return <AdminSignIn available={authenticationAvailable()} />;
  if (destination && !addAccount) redirect(destination);
  // Google returns here with ?google=1&error=CODE; the plain error is a failed email link.
  const fromGoogle = params.google === "1";
  return (
    <AuthForm
      mode="sign-in"
      available={authenticationAvailable()}
      verified={params.potvrdeno === "1" && !params.error}
      verificationError={!!params.error && !fromGoogle}
      google={googleSignInAvailable()}
      googleError={fromGoogle ? (params.error ?? "UNKNOWN") : undefined}
      returnTo={accountReturnPath(params.nastavi)}
      addAccount={addAccount}
    />
  );
}
