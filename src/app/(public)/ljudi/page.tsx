import { PeopleSearch } from "../../../components/connections/PeopleSearch";
export const metadata = { title: "Ljudi" };
export default function PeoplePage() {
  return (
    <main id="glavni-sadrzaj" className="container" style={{ paddingBlock: 40 }}>
      <PeopleSearch />
    </main>
  );
}
