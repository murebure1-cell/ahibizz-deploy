import { AuthForm } from "../../../components/auth/AuthForm";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthForm
      mode="reset-password"
      available={authenticationAvailable()}
      token={typeof params.token === "string" ? params.token : undefined}
    />
  );
}
