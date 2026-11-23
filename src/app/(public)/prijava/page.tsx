import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../components/auth/AuthForm";
import { accountReturnPath } from "../../../lib/account-return";
import { signedInReturnPath } from "../../../lib/session-navigation";
import { getAccountService } from "../../../server/auth/accounts";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export const metadata = { title: "Prijava" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ potvrdeno?: string; error?: string; nastavi?: string | string[] }>;
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
  if (destination) redirect(destination);
  return (
    <AuthForm
      mode="sign-in"
      available={authenticationAvailable()}
      verified={params.potvrdeno === "1" && !params.error}
      verificationError={!!params.error}
      returnTo={accountReturnPath(params.nastavi)}
    />
  );
}
