import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportPage } from "../../../components/support/SupportPage";
import { getSupportConfig } from "../../../lib/support";

export const metadata: Metadata = { title: "Doniraj za razvoj AhiBizza" };

export default function SupportRoute() {
  const config = getSupportConfig();
  if (!config) notFound();
  return <SupportPage config={config} />;
}
