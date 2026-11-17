"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ImportStorage, importActor } from "../../lib/business-import";
import {
  browserLocationBatchLock,
  type LocationBatch,
  type LocationBatchApi,
  type LocationBatchJournal,
  type LocationBatchPreview,
  loadLocationBatchJournal,
  locationBatchClient,
  parseLocationBatch,
  previewLocationBatch,
  retireLocationBatch,
  runLocationBatch,
} from "../../lib/business-location-batch";
import styles from "./business-import.module.css";
import { AdminRequestError } from "./responses";

function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVALID_FILE") return "Izaberi ispravnu datoteku s pregledanim lokacijama.";
  if (code === "DIFFERENT_BATCH")
    return "Za nastavak izaberi istu datoteku kao pri prvom pokretanju.";
  if (code === "BUSINESS_CHANGED")
    return "Naziv, adresa, vlasništvo ili lokacija su promijenjeni. Postupak je zaustavljen.";
  if (code === "STORAGE_UNAVAILABLE" || code === "INVALID_JOURNAL")
    return "Napredak se ne može sigurno sačuvati. Postupak je zaustavljen.";
  if (code === "BATCH_RUNNING") return "Postavljanje lokacija je već otvoreno u drugoj kartici.";
  if (code === "LOCK_UNAVAILABLE")
    return "Za sigurno postavljanje otvori ovu stranicu u novijem Edgeu ili Chromeu.";
  return "Odgovor nije potvrđen. Ponovo provjeri istu datoteku; izmjena se neće automatski ponoviti.";
}
/** Reviewed file data only. All real requests use the existing actor-bound same-origin directory API. */
export function BusinessLocationBatch({
  expectedAccountId,
  apiFactory = locationBatchClient,
  storage: suppliedStorage,
  lock = browserLocationBatchLock,
}: {
  expectedAccountId: string;
  apiFactory?: (actor: string, signal: AbortSignal) => LocationBatchApi;
  storage?: ImportStorage;
  lock?: typeof browserLocationBatchLock;
}) {
  const [batch, setBatch] = useState<LocationBatch | null>(null);
  const [preview, setPreview] = useState<LocationBatchPreview[] | null>(null);
  const [journal, setJournal] = useState<LocationBatchJournal | null>(null);
  const [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const api = useRef(apiFactory);
  api.current = apiFactory;
  const storage = () => {
    try {
      return suppliedStorage ?? window.localStorage;
    } catch {
      throw new Error("STORAGE_UNAVAILABLE");
    }
  };
  const clearDenied = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    setBatch(null);
    setPreview(null);
    setJournal(null);
    setBusy(false);
    setDenied(true);
    setError("Prijava ili administratorski pristup više nisu dostupni.");
    if (input.current) input.current.value = "";
  }, []);
  function report(error: unknown) {
    if (
      (error instanceof Error && error.message === "ACTOR_CHANGED") ||
      (error instanceof AdminRequestError && [401, 403].includes(error.status))
    )
      clearDenied();
    else setError(errorText(error));
  }
  useEffect(() => {
    let focused: AbortController | null = null;
    const check = () => {
      focused?.abort();
      const local = new AbortController();
      focused = local;
      void api
        .current(expectedAccountId, local.signal)
        .account()
        .then((account) => {
          if (!local.signal.aborted && !importActor(account, expectedAccountId)) clearDenied();
        })
        .catch((error) => {
          if (
            !local.signal.aborted &&
            error instanceof AdminRequestError &&
            [401, 403].includes(error.status)
          )
            clearDenied();
        });
    };
    window.addEventListener("focus", check);
    return () => {
      generation.current++;
      controller.current?.abort();
      focused?.abort();
      window.removeEventListener("focus", check);
    };
  }, [expectedAccountId, clearDenied]);
  async function select(file: File | undefined) {
    if (running.current) return;
    controller.current?.abort();
    const local = new AbortController();
    controller.current = local;
    const id = ++generation.current;
    setBatch(null);
    setPreview(null);
    setJournal(null);
    setError("");
    setDenied(false);
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 65536) throw new Error("INVALID_FILE");
      const next = await parseLocationBatch(new Uint8Array(await file.arrayBuffer()));
      if (local.signal.aborted || id !== generation.current) return;
      const saved = loadLocationBatchJournal(storage(), expectedAccountId, next);
      const checked = await previewLocationBatch({
        api: api.current(expectedAccountId, local.signal),
        actor: expectedAccountId,
        batch: next,
        journal: saved,
        signal: local.signal,
      });
      if (local.signal.aborted || id !== generation.current) return;
      setBatch(next);
      setJournal(saved);
      setPreview(checked);
    } catch (error) {
      if (!local.signal.aborted && id === generation.current) report(error);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }
  async function apply() {
    if (!batch || !preview || busy || denied || running.current) return;
    const local = controller.current,
      id = generation.current;
    if (!local || local.signal.aborted) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await lock(expectedAccountId, local.signal, async () => {
        const checked = await runLocationBatch({
          api: api.current(expectedAccountId, local.signal),
          actor: expectedAccountId,
          batch,
          storage: storage(),
          signal: local.signal,
          onProgress: (value) => {
            if (!local.signal.aborted && id === generation.current) setJournal(value);
          },
        });
        if (!local.signal.aborted && id === generation.current) setJournal(checked);
      });
    } catch (error) {
      if (!local.signal.aborted && id === generation.current) report(error);
    } finally {
      running.current = false;
      if (id === generation.current) setBusy(false);
    }
  }
  const completed = journal?.done.length ?? 0,
    finished = !!batch && completed === batch.records.length;
  async function newBatch() {
    if (!batch || !finished || busy || denied || running.current) return;
    const local = controller.current;
    if (!local || local.signal.aborted) return;
    running.current = true;
    setBusy(true);
    try {
      await lock(expectedAccountId, local.signal, async () => {
        if (
          !importActor(
            await api.current(expectedAccountId, local.signal).account(),
            expectedAccountId,
          )
        )
          throw new Error("ACTOR_CHANGED");
        if (local.signal.aborted) return;
        retireLocationBatch(storage(), expectedAccountId, batch);
        generation.current++;
        setBatch(null);
        setJournal(null);
        setPreview(null);
        if (input.current) input.current.value = "";
      });
    } catch (error) {
      if (!local.signal.aborted) report(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <main id="glavni-sadrzaj" className={styles.layout}>
      <header className={styles.heading}>
        <Link href="/administracija?odjeljak=djelatnosti">← Djelatnosti</Link>
        <h1>Lokacije djelatnosti</h1>
      </header>
      <section className={styles.panel}>
        <label className={styles.label} htmlFor="location-batch-file">
          Pregledane lokacije
        </label>
        <input
          ref={input}
          id="location-batch-file"
          type="file"
          accept="application/json,.json"
          disabled={busy || denied}
          onChange={(event) => void select(event.target.files?.[0])}
        />
        <p className={styles.hint}>
          Tačke zgrada prema adresama. Prije postavljanja provjeri svaku lokaciju.
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {denied && <Link href="/prijava?nastavi=%2Fadministracija%2Flokacije">Na prijavu</Link>}
        {busy && <p role="status">Provjera lokacija…</p>}
      </section>
      {batch && preview && (
        <section className={styles.panel}>
          <div className={styles.summary}>
            <div>
              <strong>{batch.records.length}</strong>
              <span>Pregledane adrese</span>
            </div>
            <div>
              <strong>{completed}</strong>
              <span>Postavljene lokacije</span>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Djelatnost</th>
                  <th scope="col">Adresa</th>
                  <th scope="col">Tačka i izvor</th>
                  <th scope="col">Stanje</th>
                </tr>
              </thead>
              <tbody>
                {batch.records.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.title}</th>
                    <td>
                      {row.addressLine}
                      <br />
                      {row.city}, {row.countryCode}
                    </td>
                    <td>
                      {row.proposed.latitude}, {row.proposed.longitude}
                      <br />
                      OSM {row.provenance.osmType}:{row.provenance.osmId}
                      <br />
                      <span className={styles.hint}>
                        {new Date(row.provenance.checkedUtc).toLocaleDateString("bs")}
                      </span>
                    </td>
                    <td>
                      {journal?.done.some((r) => r.id === row.id)
                        ? "Postavljeno"
                        : journal?.pending?.id === row.id
                          ? "Odgovor čeka provjeru"
                          : "Spremno"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy || denied || finished}
            >
              {finished
                ? "Lokacije su postavljene"
                : journal?.pending
                  ? "Provjeri napredak i nastavi"
                  : `Postavi ${batch.records.length} lokacija`}
            </button>
            {finished && (
              <button type="button" disabled={busy || denied} onClick={() => void newBatch()}>
                Nova provjera
              </button>
            )}
          </div>
          <p className={styles.hint}>
            Izvor potvrđuje adresu zgrade, ne poslovanje ili vlasništvo djelatnosti.
          </p>
        </section>
      )}
    </main>
  );
}
