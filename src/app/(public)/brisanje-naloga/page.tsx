import { RequestScreen } from "../../../components/support/RequestScreen";
import { titled } from "../../../server/i18n";
export const dynamic = "force-dynamic";
export const generateMetadata = titled("Brisanje naloga");
export default function AccountDeletionPage() {
  return <RequestScreen target={{ subject: "deletion", reference: "" }} />;
}
