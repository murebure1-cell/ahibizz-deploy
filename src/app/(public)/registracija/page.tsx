import { AuthForm } from "../../../components/auth/AuthForm";
import { authenticationAvailable } from "../../../server/auth-availability";
export const dynamic = "force-dynamic";
export default function RegistrationPage() {
  return <AuthForm mode="sign-up" available={authenticationAvailable()} />;
}
