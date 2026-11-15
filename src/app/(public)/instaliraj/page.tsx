import type { Metadata } from "next";
import { InstallPage } from "../../../components/pwa/InstallPage";

export const metadata: Metadata = { title: "Instaliraj AhiBizz" };

export default function Install() {
  return <InstallPage />;
}
