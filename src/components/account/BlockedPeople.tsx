"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  type BlockedPeople as BlockedList,
  type BlockState,
  blockRequestMessage,
  blocksRequest,
} from "../../lib/account-blocks";
import { Icon } from "../Icon";
import styles from "./blocks.module.css";

export function BlockedPeople({ accountId, initial }: { accountId: string; initial: BlockedList }) {
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
        setMessage("Postavka je sačuvana.");
        router.refresh();
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(blockRequestMessage(failure));
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
      <section className={styles.filterPanel} aria-label="Vidljivost u pretrazi">
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={data.hideInSearch}
            disabled={busy}
            onChange={(event) => {
              const hideInSearch = event.currentTarget.checked;
              void update(data.page, async (signal) => {
                await blocksRequest(accountId, "", {
                  method: "PATCH",
                  body: JSON.stringify({ hideInSearch }),
                  signal,
                });
              });
            }}
          />
          <span>
            <strong>Sakrij djelatnosti blokiranih korisnika u pretrazi</strong>
            <span>Odnosi se na rezultate pretrage i prijedloge u Reelsima dok si prijavljen.</span>
          </span>
        </label>
      </section>
      <section className={styles.listPanel} aria-label="Korisnici koje sam blokirao">
        {data.items.length > 0 ? (
          <ul className={styles.list}>
            {data.items.map((item) => (
              <li key={item.id}>
                <span className={styles.personIcon}>
                  <Icon name="user" />
                </span>
                <strong>{item.name}</strong>
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
                        Potvrdi odblokiranje
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={styles.quiet}
                        onClick={() => setConfirm(null)}
                      >
                        Odustani
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirm(item.id)}
                      aria-label={`Odblokiraj ${item.name}`}
                    >
                      Odblokiraj
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nemaš blokiranih korisnika.</p>
        )}
        {(data.page > 1 || data.hasMore) && (
          <nav className={styles.pagination} aria-label="Stranice blokiranih korisnika">
            <button
              type="button"
              disabled={busy || data.page === 1}
              onClick={() => void update(data.page - 1)}
            >
              Prethodna
            </button>
            <span>Stranica {data.page}</span>
            <button
              type="button"
              disabled={busy || !data.hasMore}
              onClick={() => void update(data.page + 1)}
            >
              Sljedeća
            </button>
          </nav>
        )}
      </section>
      {message && <p role="status">{message}</p>}
      {error && (
        <div className={styles.feedback} role="alert">
          <p>{error}</p>
          <button disabled={busy} onClick={() => void update(data.page)} type="button">
            Učitaj trenutno stanje
          </button>
        </div>
      )}
      <Link className={styles.backLink} href="/nalog?odjeljak=postavke">
        <Icon name="sliders" /> Postavke naloga
      </Link>
    </div>
  );
}
