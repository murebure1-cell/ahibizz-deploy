import { RouteLoading } from "../../components/RouteLoading";
import { getTranslator } from "../../server/i18n";

// Header, footer and bottom menu stay in place; only the page area shows this while it loads.
export default async function Loading() {
  const t = await getTranslator();
  return <RouteLoading label={t("Učitavanje stranice")} />;
}
