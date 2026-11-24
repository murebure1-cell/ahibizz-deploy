import { AuthForm } from "../../../components/auth/AuthForm";
import { authenticationAvailable } from "../../../server/auth-availability";
import { titled } from "../../../server/i18n";
export const dynamic = "force-dynamic";
export const generateMetadata = titled("Nova lozinka", { robots: { index: false, follow: false } });
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
