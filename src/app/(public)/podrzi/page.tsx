import { notFound } from "next/navigation";
import { SupportPage } from "../../../components/support/SupportPage";
import { getSupportConfig } from "../../../lib/support";
import { titled } from "../../../server/i18n";

export const generateMetadata = titled("Doniraj za razvoj AhiBizza");

export default function SupportRoute() {
  const config = getSupportConfig();
  if (!config) notFound();
  return <SupportPage config={config} />;
}
