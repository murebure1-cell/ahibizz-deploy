import Link from "next/link";
import { getTranslator } from "../../server/i18n";
import { Icon } from "../Icon";
import styles from "./app-sign-in.module.css";

export type AppSignInView =
  | { kind: "invalid" }
  | { kind: "unavailable" }
  /** The administration account works on the website only; `path` leads back here. */
  | { kind: "refused"; path: string }
  | {
      kind: "confirm";
      challenge: string;
      state: string;
      /** This page's own address, for signing in with another account and coming back. */
      path: string;
      account: { id: string; name: string; email: string };
      /** Set when the last confirmation did not reach the app. */
      failure?: string;
    };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => [...part][0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * "Prijava u aplikaciju": the account the app will be signed in to, and one action that hands
 * the app its one-time code. A plain form, so the code never passes through a script.
 */
export async function AppSignIn({ view }: { view: AppSignInView }) {
  const t = await getTranslator();
  if (view.kind === "refused")
    return (
      <main id="glavni-sadrzaj" className={styles.page}>
        <div className={styles.head}>
          <span className={styles.sign} data-kind="error">
            <Icon name="shield" />
          </span>
          <h1>{t("Ovaj nalog se ne prijavljuje u aplikaciju")}</h1>
          <p className={styles.intro}>
            {t("Nalog administracije radi samo na webu. U aplikaciju se prijavi ličnim nalogom.")}
          </p>
        </div>
        <Link
          href={`/prijava?dodaj=1&nastavi=${encodeURIComponent(view.path)}`}
          className={styles.submit}
          prefetch={false}
        >
          {t("Prijavi se drugim nalogom")}
        </Link>
      </main>
    );
  if (view.kind !== "confirm")
    return (
      <main id="glavni-sadrzaj" className={styles.page}>
        <div className={styles.head}>
          <span className={styles.sign} data-kind="error">
            <Icon name={view.kind === "invalid" ? "close" : "info"} />
          </span>
          <h1>
            {view.kind === "invalid"
              ? t("Link za prijavu nije ispravan")
              : t("Prijava trenutno nije dostupna")}
          </h1>
          <p className={styles.intro}>
            {view.kind === "invalid"
              ? t("Vrati se u aplikaciju i pokreni prijavu ponovo.")
              : t("Pokušaj ponovo za nekoliko minuta.")}
          </p>
        </div>
      </main>
    );
  const { account } = view;
  return (
    <main id="glavni-sadrzaj" className={styles.page}>
      <div className={styles.head}>
        <span className={styles.sign}>
          <Icon name="phone" />
        </span>
        <h1>{t("Prijava u aplikaciju")}</h1>
        <p className={styles.intro}>
          {t("Nastavi samo ako je prijava upravo pokrenuta u aplikaciji AhiBizz.")}
        </p>
      </div>
      <div className={styles.account}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(account.name)}
        </span>
        <span className={styles.who}>
          <strong>{account.name}</strong>
          <span>{account.email}</span>
        </span>
      </div>
      {view.failure && (
        <p role="alert" className={styles.error}>
          {view.failure === "previse"
            ? t("Previše pokušaja. Pokušaj za nekoliko minuta.")
            : t("Prijava u aplikaciju nije uspjela. Pokušaj ponovo.")}
        </p>
      )}
      <form method="post" action="/api/account/app-sign-in" className={styles.form}>
        <input type="hidden" name="izazov" value={view.challenge} />
        <input type="hidden" name="stanje" value={view.state} />
        <input type="hidden" name="nalog" value={account.id} />
        <button type="submit" className={styles.submit}>
          {t("Nastavi u aplikaciji")}
        </button>
      </form>
      <Link
        href={`/prijava?dodaj=1&nastavi=${encodeURIComponent(view.path)}`}
        className={styles.quiet}
        prefetch={false}
      >
        {t("Prijavi se drugim nalogom")}
      </Link>
      <p className={styles.note}>
        {t("Aplikacija dobija svoju prijavu. Odjava na webu je ne odjavljuje.")}
      </p>
    </main>
  );
}
