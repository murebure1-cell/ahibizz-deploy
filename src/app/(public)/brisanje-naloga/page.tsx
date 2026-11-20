import { RequestScreen } from "../../../components/support/RequestScreen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Brisanje naloga" };
export default function AccountDeletionPage() {
  return <RequestScreen target={{ subject: "deletion", reference: "" }} />;
}
