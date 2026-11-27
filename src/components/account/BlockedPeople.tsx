"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type BlockedPeople as BlockedList,
  type BlockState,
  blockRequestMessage,
  blocksRequest,
} from "../../lib/account-blocks";
import { accountDate } from "../../lib/display-date";
import { useT } from "../i18n/LocaleProvider";
import { profileInitials } from "../people/PersonalProfileCard";
import { Switch } from "../ui/Switch";
import styles from "./blocks.module.css";

export function BlockedPeople({ accountId, initial }: { accountId: string; initial: BlockedList }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const router = useRouter();
  useEffect(() => () => running.current?.abort(), []);

  async function update(page: number, operation?: (signal: AbortSignal) => Promise<void>) {
    if (running.current && !running.current.signal.aborted) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (operation) await operation(controller.signal);
      let list = await blocksRequest<BlockedList>(accountId, `?page=${page}`, {
        signal: controller.signal,
      });
      if (!list.items.length && page > 1)
        list = await blocksRequest<BlockedList>(accountId, `?page=${page - 1}`, {
          signal: controller.signal,
        });
      setData(list);
      setConfirm(null);
      if (operation) {
        setMessage(t("Postavka je sačuvana."));
        router.refresh();
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(t(blockRequestMessage(failure)));
        setConfirm(null);
      }
    } finally {
      if (running.current === controller) {
        running.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  return (
    <div className={styles.workspace} aria-busy={busy}>
      <section className={styles.listPanel} aria-label={t("Blokirani korisnici")}>
        {data.items.length > 0 ? (
          <ul className={styles.list}>
            {data.items.map((item) => (
              <li key={item.id}>
                <span className={styles.initials} aria-hidden="true">
                  {profileInitials(item.name)}
                </span>
                <span className={styles.who}>
                  <strong dir="auto">{item.name}</strong>
                  {item.blockedAt && (
                    <small>
                      {t("Blokiran")} {accountDate(item.blockedAt)}
                    </small>
                  )}
                </span>
                <div className={styles.actions}>
                  {confirm === item.id ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void update(data.page, async (signal) => {
                            await blocksRequest<BlockState>(
                              accountId,
                              `/${encodeURIComponent(item.id)}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  blocked: false,
                                  expectedVersion: item.version,
                                }),
                                signal,
                              },
                            );
                          });
                        }}
                      >
                        {t("Potvrdi odblokiranje")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={styles.quiet}
                        onClick={() => setConfirm(null)}
                      >
                        {t("Odustani")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirm(item.id)}
                      aria-label={`${t("Odblokiraj")} ${item.name}`}
                    >
                      {t("Odblokiraj")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{t("Nemaš blokiranih korisnika.")}</p>
        )}
        {(data.page > 1 || data.hasMore) && (
          <nav className={styles.pagination} aria-label={t("Stranice blokiranih korisnika")}>
            <button
              type="button"
              disabled={busy || data.page === 1}
              onClick={() => void update(data.page - 1)}
            >
              {t("Prethodna")}
            </button>
            <span>{data.page}</span>
            <button
              type="button"
              disabled={busy || !data.hasMore}
              onClick={() => void update(data.page + 1)}
            >
              {t("Sljedeća")}
            </button>
          </nav>
        )}
      </section>
      {message && <p role="status">{message}</p>}
      {error && (
        <div className={styles.feedback} role="alert">
          <p>{error}</p>
          <button disabled={busy} onClick={() => void update(data.page)} type="button">
            {t("Učitaj trenutno stanje")}
          </button>
        </div>
      )}
      <section className={styles.filterPanel} aria-label={t("Vidljivost u pretrazi")}>
        <div className={styles.option}>
          <span>
            <strong>{t("Sakrij djelatnosti blokiranih korisnika u pretrazi")}</strong>
            <span>{t("Važi za pretragu i prijedloge u Reelsima dok koristiš svoj nalog.")}</span>
          </span>
          <Switch
            checked={data.hideInSearch}
            disabled={busy}
            label={t("Sakrij djelatnosti blokiranih korisnika u pretrazi")}
            onChange={(hideInSearch) => {
              void update(data.page, async (signal) => {
                await blocksRequest(accountId, "", {
                  method: "PATCH",
                  body: JSON.stringify({ hideInSearch }),
                  signal,
                });
              });
            }}
          />
        </div>
      </section>
    </div>
  );
}
