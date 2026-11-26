import { PublicPersonProfile } from "../../../../components/connections/PublicPersonProfile";
import look from "../../../../components/connections/person-profile.module.css";
import { titled } from "../../../../server/i18n";
export const generateMetadata = titled("Lični profil", {
  robots: { index: false, follow: false },
});
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main id="glavni-sadrzaj" className={look.screen}>
      <PublicPersonProfile
        key={id}
        personId={id}
        loginHref={`/prijava?nastavi=${encodeURIComponent(`/ljudi/${encodeURIComponent(id)}`)}`}
      />
    </main>
  );
}
