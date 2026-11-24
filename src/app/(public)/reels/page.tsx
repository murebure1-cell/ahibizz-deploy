import Link from "next/link";
import { ReelCards } from "../../../components/reels/ReelShelf";
import styles from "../../../components/reels/reels.module.css";
import { businessUuid } from "../../../lib/business-today";
import { listPublicReels } from "../../../server/reels/service";
import { currentReelViewer } from "../../../server/reels/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reels djelatnosti" };
type Query = { djelatnost?: string | string[]; stranica?: string | string[] };
const pageSize = 24;

export default async function ReelsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const businessId = businessUuid(query.djelatnost) ? query.djelatnost.toLowerCase() : null;
  const page =
    typeof query.stranica === "string" && /^[1-9]\d{0,2}$/.test(query.stranica)
      ? Number(query.stranica)
      : 1;
  const results = await listPublicReels(
    businessId,
    pageSize + 1,
    (page - 1) * pageSize,
    await currentReelViewer(),
  ).catch(() => null);
  const businessTitle = businessId && results?.[0]?.businessTitle;
  const href = (n: number) =>
    `/reels?stranica=${n}${businessId ? `&djelatnost=${businessId}` : ""}`;
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <header>
        <Link href={businessId ? `/djelatnosti/${businessId}` : "/"} className={styles.back}>
          {businessId ? "Na djelatnost" : "Početna"}
        </Link>
        <h1>{businessTitle ? `Reels · ${businessTitle}` : "Reels djelatnosti"}</h1>
      </header>
      {results?.length ? (
        <ReelCards reels={results.slice(0, pageSize)} businessScope={businessId} page={page} />
      ) : (
        <p className={styles.empty}>
          {results
            ? "Na ovoj stranici još nema reelova."
            : "Reels trenutno nisu dostupni. Pokušaj ponovo kasnije."}
        </p>
      )}
      {(page > 1 || (results && results.length > pageSize && page < 999)) && (
        <nav className={styles.pagination} aria-label="Stranice reelova">
          {page > 1 && <Link href={href(page - 1)}>Prethodna</Link>}
          {results && results.length > pageSize && page < 999 && (
            <Link href={href(page + 1)}>Sljedeća</Link>
          )}
        </nav>
      )}
      <Link href="/nalog/reels" className={styles.primary}>
        Objavi Reel
      </Link>
      <p className={styles.caption}>Svaki Reel je vidljiv najviše 24 sata od objave.</p>
    </main>
  );
}
