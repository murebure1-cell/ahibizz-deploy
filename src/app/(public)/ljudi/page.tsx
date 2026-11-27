import { PeopleSearch } from "../../../components/connections/PeopleSearch";
import { rowStyles, ScreenBar } from "../../../components/ui/Rows";
import { getTranslator, titled } from "../../../server/i18n";

export const generateMetadata = titled("Ljudi");

export default async function PeoplePage() {
  const t = await getTranslator();
  return (
    <main id="glavni-sadrzaj" className={rowStyles.screen}>
      <ScreenBar title={t("Ljudi")} backHref="/nalog?odjeljak=profil" backLabel={t("Nazad")} />
      <PeopleSearch heading={false} />
    </main>
  );
}
