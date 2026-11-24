import { RouteLoading } from "../../../components/RouteLoading";
import { getTranslator } from "../../../server/i18n";

// Lists without redirects or 404s can stream: the skeleton shows while results load.
export default async function Loading() {
  const t = await getTranslator();
  return <RouteLoading label={t("Učitavanje stranice")} />;
}
