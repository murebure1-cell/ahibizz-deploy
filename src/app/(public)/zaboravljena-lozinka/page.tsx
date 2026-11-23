import { AuthForm } from "../../../components/auth/AuthForm";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export const metadata = { title: "Zaboravljena lozinka" };
export default function ResetRequestPage() {
  return <AuthForm mode="reset-request" available={authenticationAvailable()} />;
}
