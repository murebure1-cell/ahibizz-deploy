import type { BusinessMenu } from "../../lib/business-menu";
import { menuPrice } from "../../lib/business-menu";
import { readPublicMenu } from "../../server/business-menu";
import { getDatabase } from "../../server/db";
import { getTranslator } from "../../server/i18n";
import styles from "./menu-offer.module.css";

/** Reads the menu on the server; a business page still opens when it cannot be read. */
export async function BusinessMenuBlock({ businessId }: { businessId: string }) {
  try {
    const database = getDatabase();
    if (!database.configured()) return null;
    return <BusinessMenuSections menu={await readPublicMenu(database, businessId)} />;
  } catch {
    return null;
  }
}

/** "Jelovnik" and "Porijeklo mesa" on a business page, as drawn (Djelatnost). */
export async function BusinessMenuSections({ menu }: { menu: BusinessMenu }) {
  if (!menu.items.length && !menu.meat.length) return null;
  const t = await getTranslator();
  const first = menu.items.slice(0, 5);
  const rest = menu.items.slice(5);
  const row = (item: BusinessMenu["items"][number], key: number) => (
    <li key={key}>
      <span dir="auto">{item.name}</span>
      {item.priceCents !== null && <strong>{menuPrice(item.priceCents)}</strong>}
    </li>
  );
  return (
    <>
      {menu.items.length > 0 && (
        <section className={styles.menu} id="business-menu" aria-labelledby="business-menu-heading">
          <h2 id="business-menu-heading">{t("Jelovnik")}</h2>
          <ul>{first.map(row)}</ul>
          {rest.length > 0 && (
            <details className={styles.more}>
              <summary>{t("Cijeli jelovnik")}</summary>
              <ul>{rest.map((item, index) => row(item, index + 5))}</ul>
            </details>
          )}
        </section>
      )}
      {menu.meat.length > 0 && (
        <section className={styles.meat} aria-labelledby="business-meat-heading">
          <h2 id="business-meat-heading">{t("Porijeklo mesa")}</h2>
          <div className={styles.meatCard}>
            {menu.meat.map((source, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the owner's order is the order shown.
              <div className={styles.source} key={index}>
                <span>
                  <small dir="auto">{source.kind}</small>
                  <strong dir="auto">{source.supplier}</strong>
                </span>
                <em>{t("Navod vlasnika")}</em>
              </div>
            ))}
            <p>{t("Podatak o dobavljaču. Nije Halal certifikat.")}</p>
          </div>
        </section>
      )}
    </>
  );
}
