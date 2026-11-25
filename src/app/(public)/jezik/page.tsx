import { LanguageScreen } from "../../../components/i18n/LanguageScreen";
import { titled } from "../../../server/i18n";

export const dynamic = "force-dynamic";
export const generateMetadata = titled("Jezik");

export default function LanguagePage() {
  return <LanguageScreen />;
}
