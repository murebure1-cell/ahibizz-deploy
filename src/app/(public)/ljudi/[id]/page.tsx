import styles from "../../../../components/connections/connections.module.css";
import { PublicPersonProfile } from "../../../../components/connections/PublicPersonProfile";
export const metadata = { title: "Lični profil", robots: { index: false, follow: false } };
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main id="glavni-sadrzaj" className={`container ${styles.personPage}`}>
      <PublicPersonProfile
        key={id}
        personId={id}
        loginHref={`/prijava?nastavi=${encodeURIComponent(`/ljudi/${encodeURIComponent(id)}`)}`}
      />
    </main>
  );
}
