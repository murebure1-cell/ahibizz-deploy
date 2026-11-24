import { PeopleSearch } from "../../../components/connections/PeopleSearch";
import { titled } from "../../../server/i18n";
export const generateMetadata = titled("Ljudi");
export default function PeoplePage() {
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: 40 }}>
      <PeopleSearch />
    </main>
  );
}
