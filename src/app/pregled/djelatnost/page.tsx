import Link from "next/link";
import { previewBusinesses } from "../../../components/preview/data";
import { ProfilePreview } from "./ProfilePreview";

export default async function BusinessProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ profil?: string | string[] }>;
}) {
  const { profil } = await searchParams;
  const id = profil === undefined ? "forma" : typeof profil === "string" ? profil : "";
  const business = previewBusinesses.find((item) => item.id === id);
  if (!business)
    return (
      <main id="glavni-sadrzaj" className="preview-container preview-space">
        <h1>Profil nije pronađen.</h1>
        <Link href="/pregled/pretraga">Nazad na pretragu</Link>
      </main>
    );
  return <ProfilePreview key={business.id} business={business} />;
}
