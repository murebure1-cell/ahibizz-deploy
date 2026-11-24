import { InstallPage } from "../../../components/pwa/InstallPage";
import { titled } from "../../../server/i18n";

export const generateMetadata = titled("Instaliraj AhiBizz");

export default function Install() {
  return <InstallPage />;
}
