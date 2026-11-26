"use client";

import { useState } from "react";
import { type BusinessMenu, menuLimits, menuPrice, parseMenuPrice } from "../../lib/business-menu";
import { Icon } from "../Icon";
import { useI18n } from "../i18n/LocaleProvider";
import styles from "./menu-offer.module.css";

type ItemRow = { name: string; price: string };
type MeatRow = { kind: string; supplier: string };

/** The owner writes the menu and where the meat comes from (canvas Djelatnost / Objava). */
export function MenuEditor({
  accountId,
  businessId,
  initial,
}: {
  accountId: string;
  businessId: string;
  initial: BusinessMenu;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<ItemRow[]>(
    initial.items.map((item) => ({
      name: item.name,
      price: item.priceCents === null ? "" : menuPrice(item.priceCents).replace(" KM", ""),
    })),
  );
  const [meat, setMeat] = useState<MeatRow[]>(initial.meat.map((row) => ({ ...row })));
  const [version, setVersion] = useState(initial.version);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const parsed = items
      .filter((row) => row.name.trim() || row.price.trim())
      .map((row) => ({ name: row.name.trim(), priceCents: parseMenuPrice(row.price) }));
    if (parsed.some((row) => !row.name || row.priceCents === undefined)) {
      setMessage({
        ok: false,
        text: t("Svako jelo treba naziv, a cijena broj, npr. 7 ili 16,50."),
      });
      return;
    }
    const sources = meat
      .filter((row) => row.kind.trim() || row.supplier.trim())
      .map((row) => ({ kind: row.kind.trim(), supplier: row.supplier.trim() }));
    if (sources.some((row) => !row.kind || !row.supplier)) {
      setMessage({ ok: false, text: t("Za meso upiši vrstu i dobavljača.") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/business-menu/${businessId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-AhiBizz-Account-ID": accountId },
        body: JSON.stringify({ items: parsed, meat: sources, expectedVersion: version }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({
          ok: false,
          text:
            result.code === "VERSION_CONFLICT"
              ? t("Jelovnik je u međuvremenu promijenjen. Osvježi stranicu.")
              : t("Spremanje nije uspjelo. Pokušaj ponovo."),
        });
        return;
      }
      setVersion(result.menu.version);
      setMessage({ ok: true, text: t("Jelovnik je sačuvan.") });
    } catch {
      setMessage({ ok: false, text: t("Spremanje nije uspjelo. Pokušaj ponovo.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.editor}>
      <section className={styles.block}>
        <h2>{t("Jelovnik")}</h2>
        <p className={styles.hint}>
          {t("Jela i cijene u KM. Prvih pet se vidi na stranici djelatnosti.")}
        </p>
        {items.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position.
          <div className={styles.itemRow} key={index}>
            <input
              aria-label={t("Naziv jela")}
              placeholder={t("Naziv jela")}
              maxLength={menuLimits.name}
              value={row.name}
              onChange={(event) =>
                setItems((list) =>
                  list.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              aria-label={t("Cijena u KM")}
              placeholder="KM"
              inputMode="decimal"
              className={styles.price}
              value={row.price}
              onChange={(event) =>
                setItems((list) =>
                  list.map((item, i) =>
                    i === index ? { ...item, price: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className={styles.remove}
              aria-label={t("Ukloni")}
              onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        {items.length < menuLimits.items && (
          <button
            type="button"
            className={styles.add}
            onClick={() => setItems((list) => [...list, { name: "", price: "" }])}
          >
            <Icon name="plus" /> {t("Dodaj jelo")}
          </button>
        )}
      </section>

      <section className={styles.block}>
        <h2>{t("Porijeklo mesa")}</h2>
        <p className={styles.hint}>
          {t(
            "Navedi od koga nabavljaš meso. Ovo je tvoj navod o dobavljaču, nije Halal certifikat.",
          )}
        </p>
        {meat.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position.
          <div className={styles.itemRow} key={index}>
            <input
              aria-label={t("Vrsta mesa")}
              placeholder={t("npr. Piletina")}
              maxLength={menuLimits.kind}
              value={row.kind}
              className={styles.kind}
              onChange={(event) =>
                setMeat((list) =>
                  list.map((item, i) =>
                    i === index ? { ...item, kind: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              aria-label={t("Dobavljač")}
              placeholder={t("Dobavljač")}
              maxLength={menuLimits.supplier}
              value={row.supplier}
              onChange={(event) =>
                setMeat((list) =>
                  list.map((item, i) =>
                    i === index ? { ...item, supplier: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className={styles.remove}
              aria-label={t("Ukloni")}
              onClick={() => setMeat((list) => list.filter((_, i) => i !== index))}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        {meat.length < menuLimits.meat && (
          <button
            type="button"
            className={styles.add}
            onClick={() => setMeat((list) => [...list, { kind: "", supplier: "" }])}
          >
            <Icon name="plus" /> {t("Dodaj dobavljača")}
          </button>
        )}
      </section>

      {message && (
        <p className={message.ok ? styles.ok : styles.error} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
      <button type="button" className={styles.save} disabled={busy} onClick={() => void save()}>
        {busy ? t("Trenutak…") : t("Sačuvaj")}
      </button>
    </div>
  );
}
