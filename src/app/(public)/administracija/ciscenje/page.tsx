import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../components/support/resources.module.css";
import { AccountAccessError } from "../../../../server/auth/accounts";
import {
  getPrelaunchReset,
  type PrelaunchResetPlan,
} from "../../../../server/maintenance/prelaunch-reset";

export const dynamic = "force-dynamic";
export const metadata = { title: "Čišćenje podataka" };
const route = "/administracija/ciscenje";
const statuses: Record<string, string> = {
  potvrda: "Upisani email ne odgovara tvom nalogu. Ništa nije obrisano.",
  blokirano: "Čišćenje je zaustavljeno. Pogledaj razloge ispod. Ništa nije obrisano.",
  provjeri: "Čišćenje nije izvršeno. Osvježi stranicu i pokušaj ponovo.",
};
const errorStatus: Record<string, string> = {
  INVALID_RESET_CONFIRMATION: "potvrda",
  RESET_BLOCKED: "blokirano",
};

async function applyReset(form: FormData) {
  "use server";
  const reset = getPrelaunchReset();
  const operatorId = form.get("operator");
  if (!reset || typeof operatorId !== "string" || !operatorId) redirect(`${route}?status=provjeri`);
  const requestHeaders = new Headers(await headers());
  requestHeaders.set("X-AhiBizz-Account-ID", operatorId);
  try {
    await reset.apply(requestHeaders, form.get("confirmation"));
  } catch (error) {
    const status = error instanceof AccountAccessError ? errorStatus[error.code] : undefined;
    redirect(`${route}?status=${status ?? "provjeri"}`);
  }
  redirect(`${route}?status=ocisceno`);
}

export default async function PrelaunchReset({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  let data: { plan: PrelaunchResetPlan; operatorId: string } | undefined;
  let closed = false;
  try {
    data = await getPrelaunchReset()?.plan(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && error.status === 401)
      redirect("/prijava?nastavi=%2Fadministracija%2Fciscenje");
    if (error instanceof AccountAccessError && error.status === 403) redirect("/nalog");
    closed = error instanceof AccountAccessError && error.status === 410;
  }
  const status = params.status && Object.hasOwn(statuses, params.status) && statuses[params.status];
  const filled = data?.plan.tables.filter((table) => table.rows > 0) ?? [];
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/administracija">Administracija</Link>
      <h1>Čišćenje podataka prije puštanja</h1>
      {status && <p role="alert">{status}</p>}
      {params.status === "ocisceno" && (
        <p className={styles.confirmed} role="status">
          Podaci su obrisani. Ostali su vlasnički nalozi, kategorije, članci, izgled i cijene.
        </p>
      )}
      {closed ? (
        <p role="alert">Ova radnja više nije dostupna.</p>
      ) : !data ? (
        <p role="alert">Pregled trenutno nije dostupan.</p>
      ) : (
        <>
          <section className={styles.section}>
            <h2>Šta ostaje</h2>
            <ul>
              {data.plan.owners.map((owner) => (
                <li key={owner.id}>Vlasnički nalog: {owner.email}</li>
              ))}
              <li>Kategorije, članci, izgled početne, pravila i cijene</li>
            </ul>
          </section>
          <section className={styles.section}>
            <h2>Šta se trajno briše</h2>
            <ul>
              <li>Djelatnosti: {data.plan.businesses}</li>
              <li>Nalozi: {data.plan.accounts}</li>
              {filled
                .filter((table) => table.name !== "directory_business")
                .map((table) => (
                  <li key={table.name}>
                    {table.name}: {table.rows}
                  </li>
                ))}
            </ul>
            <p>
              Uz to se prazni još {data.plan.tables.length - filled.length} tabela koje su već
              prazne. Brisanje se ne može poništiti iz aplikacije; povratak je moguć samo iz
              backupa.
            </p>
          </section>
          {data.plan.blockers.length > 0 ? (
            <section className={styles.section}>
              <h2>Čišćenje je zaustavljeno</h2>
              <ul>
                {data.plan.blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          ) : (
            <form action={applyReset} className={styles.form}>
              <input type="hidden" name="operator" value={data.operatorId} />
              <label>
                Za potvrdu upiši email svog naloga
                <input
                  name="confirmation"
                  type="email"
                  autoComplete="off"
                  maxLength={254}
                  required
                />
              </label>
              <button className="button button-navy" type="submit">
                Trajno obriši sve navedeno
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
