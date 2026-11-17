import { AuthForm } from "../../../components/auth/AuthForm";
import { accountReturnPath } from "../../../lib/account-return";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ nastavi?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <AuthForm
      mode="sign-up"
      available={authenticationAvailable()}
      returnTo={accountReturnPath(params.nastavi)}
    />
  );
}
