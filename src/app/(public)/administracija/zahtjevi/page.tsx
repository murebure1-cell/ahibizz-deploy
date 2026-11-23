import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../components/support/resources.module.css";
import { helpTicketLabel } from "../../../../lib/help-center";
import { reelPath } from "../../../../lib/reel-navigation";
import { supportSubjects } from "../../../../lib/support-requests";
import { getAccountErasure } from "../../../../server/account-erasure";
import { AccountAccessError } from "../../../../server/auth/accounts";
import { getSupportRequests, type OpenSupportRequest } from "../../../../server/support-requests";
import { resolveSupportRequest } from "../../../../server/support-resolution";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zahtjevi i prijave" };
const route = "/administracija/zahtjevi";
const erasureStatuses: Record<string, string> = {
  potvrda: "Email za potvrdu mora odgovarati nalogu iz zahtjeva.",
  zasticen: "Brisanje administratorskog naloga treba obraditi kroz podršku.",
  termini: "Nalog ima buduće aktivne termine. Prvo dogovori njihovu obradu s učesnicima.",
  djelatnosti: "Prvo prenesi ili ukloni djelatnosti koje su još vezane za ovaj nalog.",
  zahtjev: "Zahtjev više nije otvoren. Provjeri red zahtjeva.",
};
const erasureErrorStatus: Record<string, string> = {
  INVALID_ERASURE_CONFIRMATION: "potvrda",
  ERASURE_PROTECTED_ACCOUNT: "zasticen",
  ERASURE_BOOKING_PENDING: "termini",
  ERASURE_BUSINESS_PENDING: "djelatnosti",
  ERASURE_REQUEST_CHANGED: "zahtjev",
};

async function closeReport(form: FormData) {
  "use server";
  try {
    await resolveSupportRequest(
      getSupportRequests(),
      await headers(),
      form.get("operator"),
      form.get("id"),
    );
  } catch {
    redirect(`${route}?status=provjeri`);
  }
  revalidatePath(route);
  redirect(route);
}

async function eraseAccount(form: FormData) {
  "use server";
  const erase = getAccountErasure();
  const operatorId = form.get("operator");
  if (!erase || typeof operatorId !== "string" || !operatorId) redirect(`${route}?status=provjeri`);
  const requestHeaders = new Headers(await headers());
  requestHeaders.set("X-AhiBizz-Account-ID", operatorId);
  try {
    await erase(requestHeaders, form.get("request"), form.get("confirmation"));
  } catch (error) {
    const status = error instanceof AccountAccessError ? erasureErrorStatus[error.code] : undefined;
    redirect(`${route}?status=${status ?? "provjeri"}`);
  }
  revalidatePath(route);
  redirect(`${route}?status=obrisan`);
}

export default async function SupportQueue({
  searchParams,
}: {
  searchParams: Promise<{ strana?: string; status?: string }>;
}) {
  const params = await searchParams;
  const index = /^\d{1,5}$/.test(params.strana ?? "") ? Math.max(0, Number(params.strana) - 1) : 0;
  const service = getSupportRequests();
  let data: { requests: OpenSupportRequest[]; more: boolean; operatorId: string } | undefined;
  try {
    data = await service?.pending(await headers(), index);
  } catch (error) {
    if (error instanceof AccountAccessError && error.status === 401)
      redirect("/prijava?nastavi=%2Fadministracija%2Fzahtjevi");
    if (error instanceof AccountAccessError && error.status === 403) redirect("/nalog");
  }
  const erasureStatus =
    params.status &&
    Object.hasOwn(erasureStatuses, params.status) &&
    erasureStatuses[params.status];
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/administracija">Administracija</Link>
      <h1>Zahtjevi i prijave</h1>
      {params.status === "provjeri" && (
        <p role="alert">Provjeri status prijave prije ponovnog pokušaja.</p>
      )}
      {erasureStatus && <p role="alert">{erasureStatus}</p>}
      {params.status === "obrisan" && data && (
        <p className={styles.confirmed} role="status">
          Zahtjev za brisanje je obrađen.
        </p>
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
                <details>
                  <summary>Obradi zahtjev za brisanje</summary>
                  <p>
                    Provjeri vlasništvo naloga. Obrada trajno uklanja pristup i lične podatke.
                    Evidencija potvrđenih uplata i obrada zahtjeva se čuvaju.
                  </p>
                  <form action={eraseAccount} className={styles.form}>
                    <input type="hidden" name="operator" value={data.operatorId} />
                    <input type="hidden" name="request" value={item.id} />
                    <label>
                      Upiši email naloga
                      <input
                        name="confirmation"
                        type="email"
                        autoComplete="off"
                        maxLength={254}
                        required
                      />
                    </label>
                    <button className="button button-navy" type="submit">
                      Trajno obriši nalog
                    </button>
                  </form>
                </details>
              ) : (
                <>
                  <p>
                    {item.subject === "help" ? helpTicketLabel(item.reference) : item.reference}
                  </p>
                  <p>{item.details}</p>
                  {item.subject === "reel" && (
                    <Link href={reelPath(item.reference)}>Otvori prijavljeni Reel</Link>
                  )}
                  {item.subject === "help" && (
                    <a
                      href={`mailto:${encodeURIComponent(item.email).replace("%40", "@")}?subject=Zahtjev%20AhiBizz`}
                    >
                      Odgovori emailom
                    </a>
                  )}
                  <form action={closeReport}>
                    <input type="hidden" name="operator" value={data.operatorId} />
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
