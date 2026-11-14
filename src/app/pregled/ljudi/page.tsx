import { PeoplePreview } from "../../../components/preview/PeoplePreview";
export default async function PreviewPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ profil?: string | string[] }>;
}) {
  const query = await searchParams;
  return <PeoplePreview personId={typeof query.profil === "string" ? query.profil : undefined} />;
}
