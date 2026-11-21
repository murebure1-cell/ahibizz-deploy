import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../components/support/resources.module.css";
import { helpTicketLabel } from "../../../../lib/help-center";
import { supportSubjects } from "../../../../lib/support-requests";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getSupportRequests, type OpenSupportRequest } from "../../../../server/support-requests";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zahtjevi i prijave" };
const route = "/administracija/zahtjevi";

async function closeReport(form: FormData) {
  "use server";
  const id = form.get("id");
  const service = getSupportRequests();
  if (service && typeof id === "string") {
    try {
      await service.resolve(await headers(), id);
    } catch {
      redirect(`${route}?status=provjeri`);
    }
    revalidatePath(route);
  }
  redirect(route);
}

export default async function SupportQueue({
  searchParams,
}: {
  searchParams: Promise<{ strana?: string; status?: string }>;
}) {
  const params = await searchParams;
  const index = /^\d{1,5}$/.test(params.strana ?? "") ? Math.max(0, Number(params.strana) - 1) : 0;
  const service = getSupportRequests();
  let data: { requests: OpenSupportRequest[]; more: boolean } | undefined;
  try {
    data = await service?.pending(await headers(), index);
  } catch (error) {
    if (error instanceof AccountAccessError && error.status === 401)
      redirect("/prijava?nastavi=%2Fadministracija%2Fzahtjevi");
    if (error instanceof AccountAccessError && error.status === 403) redirect("/nalog");
  }
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/administracija">Administracija</Link>
      <h1>Zahtjevi i prijave</h1>
      {params.status === "provjeri" && (
        <p role="alert">Provjeri status prijave prije ponovnog pokušaja.</p>
      )}
      {!data ? (
        <p role="alert">Zahtjevi trenutno nisu dostupni.</p>
      ) : (
        <>
          {!data.requests.length && <p>Nema otvorenih zahtjeva na ovoj stranici.</p>}
          {data.requests.map((item) => (
            <article key={item.id} className={styles.section}>
              <h2>{supportSubjects[item.subject]}</h2>
              <p>
                {item.name} · {item.email}
              </p>
              {item.subject === "deletion" ? (
                <p>
                  Potvrdi vlasništvo i obradi brisanje naloga i povezanih podataka. Zahtjev ostaje
                  otvoren dok nalog postoji.
                </p>
              ) : (
                <>
                  <p>
                    {item.subject === "help" ? helpTicketLabel(item.reference) : item.reference}
                  </p>
                  <p>{item.details}</p>
                  {item.subject === "help" && (
                    <a
                      href={`mailto:${encodeURIComponent(item.email).replace("%40", "@")}?subject=Zahtjev%20AhiBizz`}
                    >
                      Odgovori emailom
                    </a>
                  )}
                  <form action={closeReport}>
                    <input type="hidden" name="id" value={item.id} />
                    <button className="button button-navy" type="submit">
                      Označi kao obrađeno
                    </button>
                  </form>
                </>
              )}
            </article>
          ))}
          {(index > 0 || data.more) && (
            <nav aria-label="Stranice zahtjeva">
              {index > 0 && <Link href={`${route}?strana=${index}`}>Prethodna</Link>}{" "}
              {data.more && <Link href={`${route}?strana=${index + 2}`}>Sljedeća</Link>}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
