import Form from "next/form";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { adminMailPath } from "../../../../lib/admin-navigation";
import { readEligibleNavigationRole } from "../../../../lib/session-navigation";
import {
  AccountAccessError,
  getAccountService,
  type SafeAccountProfile,
} from "../../../../server/auth/accounts";
import { authOrigin } from "../../../../server/auth/config";
import { mailExamples } from "../../../../server/mail/examples";
import { emailPreviewDocument } from "../../../../server/mail/preview";
import styles from "./email.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email poruke", robots: { index: false, follow: false } };

export default async function AdminMailPage({
  searchParams,
}: {
  searchParams: Promise<{ primjer?: string | string[] }>;
}) {
  const login = `/prijava?nastavi=${encodeURIComponent(adminMailPath)}`;
  let profile: SafeAccountProfile | undefined;
  try {
    const service = getAccountService();
    if (service) profile = await service.read(await headers());
  } catch (error) {
    if (error instanceof AccountAccessError && [401, 403].includes(error.status)) redirect(login);
  }
  if (profile && readEligibleNavigationRole(profile) !== "owner") redirect("/nalog");
  if (!profile) {
    return (
      <main id="glavni-sadrzaj" className={styles.page}>
        <h1>Administracija trenutno nije dostupna.</h1>
        <Link href={login}>Na prijavu</Link>
      </main>
    );
  }

  const { primjer } = await searchParams;
  const selected = mailExamples.find((example) => example.id === primjer) ?? mailExamples[0];
  if (!selected) notFound();
  const origin = authOrigin(
    process.env.BETTER_AUTH_URL ?? "",
    process.env.NODE_ENV === "production",
  );
  const email = selected.render(origin);
  const groups = [...new Set(mailExamples.map((example) => example.group))];

  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <Link href="/administracija" className={styles.back}>
        Administracija
      </Link>
      <h1>Email poruke</h1>
      <Form action={adminMailPath} scroll={false} className={styles.picker}>
        <label htmlFor="mail-example">Vrsta poruke</label>
        <div className={styles.controls}>
          <select id="mail-example" name="primjer" key={selected.id} defaultValue={selected.id}>
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {mailExamples
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button type="submit">Prikaži</button>
        </div>
      </Form>

      <section className={styles.preview} aria-labelledby="email-subject">
        <header className={styles.subject}>
          <div>
            <span className={styles.label}>Predmet</span>
            <h2 id="email-subject">{email.subject}</h2>
          </div>
          <span className={selected.active ? styles.active : styles.draft}>
            {selected.active ? "Aktivno slanje" : "Predložak"}
          </span>
        </header>
        <fieldset className={styles.devices}>
          <legend className={styles.hidden}>Širina pregleda</legend>
          <label>
            <input type="radio" name="device" value="desktop" defaultChecked />
            <span>Računar</span>
          </label>
          <label>
            <input type="radio" name="device" value="phone" />
            <span>Telefon</span>
          </label>
        </fieldset>
        <div className={styles.canvas}>
          <iframe
            key={selected.id}
            title={`Pregled emaila · ${email.subject}`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={emailPreviewDocument(email.html, origin)}
          />
        </div>
        <details className={styles.plain}>
          <summary>Tekstualna verzija</summary>
          <pre>{email.text}</pre>
        </details>
      </section>
    </main>
  );
}
