import { AuthForm } from "../../../components/auth/AuthForm";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export default function ResetRequestPage() {
  return <AuthForm mode="reset-request" available={authenticationAvailable()} />;
}
