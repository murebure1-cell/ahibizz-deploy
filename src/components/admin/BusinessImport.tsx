"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BusinessImportError,
  type ImportFile,
  type ImportJournal,
  type ImportStorage,
  importActor,
  importFail,
  importLimits,
  loadImportJournal,
  parseBusinessImport,
  retireCompletedImport,
} from "../../lib/business-import";
import { businessImportClient } from "../../lib/business-import-client";
import { browserImportLock, type ImportLock } from "../../lib/business-import-lock";
import {
  type ImportApi,
  type ImportPreview,
  previewBusinessImport,
  runBusinessImport,
} from "../../lib/business-import-runner";
import styles from "./business-import.module.css";
import { AdminRequestError } from "./responses";

function failureText(error: unknown): string {
  const code = error instanceof BusinessImportError ? error.code : "";
  if (code === "STORAGE_UNAVAILABLE")
    return "Preglednik ne može sačuvati napredak. Uvoz je zaustavljen.";
  if (code === "DIFFERENT_IMPORT")
    return "Za nastavak izaberi istu datoteku kao pri prvom pokretanju.";
  if (code === "PUBLISH_PENDING" || code === "CATEGORY_PENDING")
    return "Prethodni odgovor još nije potvrđen. Provjeri ponovo prije nastavka.";
  if (code === "IMPORT_RUNNING") return "Uvoz je već otvoren u drugoj kartici.";
  if (code === "LOCK_UNAVAILABLE")
    return "Za siguran uvoz otvori ovu stranicu u novijem Edgeu ili Chromeu.";
  if (
    ["BUSINESS_CHANGED", "BUSINESS_EXISTS", "CATEGORY_CONFLICT", "INVENTORY_CHANGED"].includes(code)
  )
    return "Podaci su u međuvremenu promijenjeni. Uvoz je zaustavljen radi provjere.";
  if (["INVALID_FILE", "INVALID_IMAGE", "DUPLICATE_RECORD", "FILE_TOO_LARGE"].includes(code))
    return "Datoteka nije ispravan pripremljeni uvoz javnih podataka.";
  if (code === "INVALID_JOURNAL")
    return "Sačuvani napredak nije ispravan. Potrebna je provjera prije nastavka.";
  return "Odgovor nije potvrđen. Sačuvani napredak ostaje; provjeri i nastavi s istom datotekom.";
}
/** A genuine same-origin approved-owner client. Optional dependencies are only for isolated UI fixtures. */
export function BusinessImport({
  expectedAccountId,
  apiFactory = businessImportClient,
  storage: suppliedStorage,
  lock = browserImportLock,
}: {
  expectedAccountId: string;
  apiFactory?: (actor: string, signal: AbortSignal) => ImportApi;
  storage?: ImportStorage;
  lock?: ImportLock;
}) {
  const [file, setFile] = useState<ImportFile | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [journal, setJournal] = useState<ImportJournal | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [selectedName, setSelectedName] = useState("");
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    running = useRef(false);
  const api = useRef(apiFactory);
  api.current = apiFactory;
  const storage = () => {
    try {
      return suppliedStorage ?? window.localStorage;
    } catch {
      return importFail("STORAGE_UNAVAILABLE");
    }
  };
  const clearDenied = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    setFile(null);
    setPreview(null);
    setJournal(null);
    setSelectedName("");
    setDenied(true);
    setError("Prijava ili administratorski pristup više nisu dostupni.");
    setBusy(false);
    if (input.current) input.current.value = "";
  }, []);
  function report(error: unknown) {
    if (
      (error instanceof BusinessImportError && error.code === "ACTOR_CHANGED") ||
      (error instanceof AdminRequestError && [401, 403].includes(error.status))
    )
      clearDenied();
    else setError(failureText(error));
  }
  useEffect(() => {
    const focus = () => {
      const local = new AbortController();
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
      return local;
    };
    let current: AbortController | undefined;
    const check = () => {
      current?.abort();
      current = focus();
    };
    window.addEventListener("focus", check);
    return () => {
      generation.current++;
      controller.current?.abort();
      current?.abort();
      window.removeEventListener("focus", check);
    };
    // This component is keyed by actor; no selected data survives an actor change.
  }, [expectedAccountId, clearDenied]);
  async function select(selected: File | undefined) {
    if (running.current) return;
    controller.current?.abort();
    const local = new AbortController();
    controller.current = local;
    const id = ++generation.current;
    setFile(null);
    setPreview(null);
    setJournal(null);
    setSelectedName("");
    setError("");
    setDenied(false);
    if (!selected) return;
    setBusy(true);
    try {
      if (selected.size > importLimits.file) importFail("FILE_TOO_LARGE");
      const parsed = await parseBusinessImport(new Uint8Array(await selected.arrayBuffer()));
      if (local.signal.aborted || id !== generation.current) return;
      const saved = loadImportJournal(storage(), expectedAccountId, parsed);
      const checked = await previewBusinessImport(
        api.current(expectedAccountId, local.signal),
        expectedAccountId,
        parsed,
      );
      if (local.signal.aborted || id !== generation.current) return;
      setFile(parsed);
      setPreview(checked);
      setJournal(saved);
      setSelectedName(selected.name);
    } catch (error) {
      if (!local.signal.aborted && id === generation.current) report(error);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }
  async function start() {
    if (!file || !preview || busy || running.current || denied) return;
    const selected = file,
      id = generation.current,
      local = controller.current;
    if (!local || local.signal.aborted) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await lock(expectedAccountId, local.signal, async () => {
        const result = await runBusinessImport({
          api: api.current(expectedAccountId, local.signal),
          actor: expectedAccountId,
          file: selected,
          storage: storage(),
          signal: local.signal,
          onProgress: (j) => {
            if (id === generation.current && !local.signal.aborted) setJournal(j);
          },
        });
        if (id === generation.current && !local.signal.aborted) setJournal(result);
      });
    } catch (error) {
      if (!local.signal.aborted && id === generation.current) report(error);
    } finally {
      running.current = false;
      if (id === generation.current) setBusy(false);
    }
  }
  const completed = journal?.rows.filter((r) => r.stage === "done").length ?? 0;
  async function newImport() {
    if (!file || busy || running.current || denied) return;
    const local = controller.current;
    if (!local || local.signal.aborted) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await lock(expectedAccountId, local.signal, async () => {
        if (
          !importActor(
            await api.current(expectedAccountId, local.signal).account(),
            expectedAccountId,
          )
        )
          importFail("ACTOR_CHANGED");
        if (local.signal.aborted) importFail("STOPPED");
        retireCompletedImport(storage(), expectedAccountId, file);
        generation.current++;
        setFile(null);
        setPreview(null);
        setJournal(null);
        setSelectedName("");
        if (input.current) input.current.value = "";
      });
    } catch (error) {
      if (!local.signal.aborted) report(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const existing = journal
    ? journal.rows.filter((r) => r.stage === "existing").length
    : new Set(preview?.existing.map((r) => r.sourceId)).size;
  const finished =
    !!file && !!journal && journal.rows.every((r) => ["done", "existing"].includes(r.stage));
  return (
    <main id="glavni-sadrzaj" className={styles.layout}>
      <header className={styles.heading}>
        <div>
          <Link href="/administracija?odjeljak=djelatnosti">← Djelatnosti</Link>
          <h1>Uvoz djelatnosti</h1>
        </div>
      </header>
      <section className={styles.panel} aria-label="Pripremljeni javni podaci">
        <label className={styles.label} htmlFor="business-import-file">
          Pripremljena JSON datoteka
        </label>
        <input
          ref={input}
          id="business-import-file"
          type="file"
          accept="application/json,.json"
          disabled={busy || denied}
          onChange={(e) => void select(e.target.files?.[0])}
        />
        <p className={styles.hint}>
          Javni podaci i logotipi. Postojeće djelatnosti ostaju sačuvane.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {denied && <Link href="/prijava?nastavi=%2Fadministracija%2Fuvoz-prijava">Na prijavu</Link>}
      </section>
      {file && preview && (
        <>
          <section className={styles.panel}>
            <div className={styles.summary}>
              <div>
                <strong>{file.records.length}</strong>
                <span>Djelatnosti</span>
              </div>
              <div>
                <strong>{existing}</strong>
                <span>Preskočeno postojećih</span>
              </div>
              <div>
                <strong>{completed}</strong>
                <span>Objavljeno</span>
              </div>
            </div>
            <p className={styles.hint}>
              {selectedName} · {file.hash.slice(0, 12)}
            </p>
            {!finished && preview.missingCategories.length > 0 && (
              <details open>
                <summary>Kategorije za dodavanje ({preview.missingCategories.length})</summary>
                <ul>
                  {preview.missingCategories.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy || finished || denied}
                onClick={() => void start()}
              >
                {busy
                  ? "Uvoz je u toku…"
                  : finished
                    ? "Uvoz završen"
                    : journal
                      ? "Provjeri i nastavi"
                      : "Objavi djelatnosti"}
              </button>
              {finished && (
                <button type="button" disabled={busy || denied} onClick={() => void newImport()}>
                  Novi uvoz
                </button>
              )}
              <span role="status" aria-live="polite">
                {finished
                  ? "Sve potvrđene objave su sačuvane."
                  : journal?.pending
                    ? "Radnja čeka potvrdu."
                    : ""}
              </span>
            </div>
          </section>
          <section className={styles.panel} aria-label="Pregled djelatnosti">
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Djelatnost</th>
                    <th>Kategorija</th>
                    <th>Grad</th>
                    <th>Logo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {file.records.map((r) => {
                    const state = journal?.rows.find((s) => s.sourceId === r.sourceId),
                      status =
                        state?.stage ??
                        (preview.existing.some((e) => e.sourceId === r.sourceId)
                          ? "existing"
                          : "todo");
                    const labels = {
                      todo: "Spremna",
                      created: "Nacrt",
                      logo: "Spremna za objavu",
                      done: "Objavljena",
                      existing: "Postoji — preskočena",
                    };
                    return (
                      <tr key={r.sourceId}>
                        <th scope="row">{r.business.title}</th>
                        <td>
                          {r.category.name}
                          {r.category.subcategory ? ` / ${r.category.subcategory}` : ""}
                        </td>
                        <td>{r.business.city ?? "—"}</td>
                        <td>{r.logo ? "Da" : "—"}</td>
                        <td>{labels[status]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
