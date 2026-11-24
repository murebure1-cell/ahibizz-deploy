import { AuthForm } from "../../../components/auth/AuthForm";
import { authenticationAvailable } from "../../../server/auth-availability";
import { titled } from "../../../server/i18n";
export const dynamic = "force-dynamic";
export const generateMetadata = titled("Zaboravljena lozinka");
export default function ResetRequestPage() {
  return <AuthForm mode="reset-request" available={authenticationAvailable()} />;
}
