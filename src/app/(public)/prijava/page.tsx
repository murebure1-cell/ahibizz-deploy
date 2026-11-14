import { AuthForm } from "../../../components/auth/AuthForm";
import { accountReturnPath } from "../../../lib/account-return";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ potvrdeno?: string; error?: string; nastavi?: string | string[] }>;
}) {
  const params = await searchParams;
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
