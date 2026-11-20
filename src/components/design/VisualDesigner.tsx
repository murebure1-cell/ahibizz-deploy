"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DesignVariant,
  defaultVisualDesign,
  designProperties,
  designTargets,
  parseVisualDesign,
  type VisualDesign,
} from "../../lib/visual-design";
import type { VisualDesignState } from "../../server/visual-design-store";
import { designerFramePath } from "./AppProviders";
import { HomeEditor, StyleInspector } from "./DesignInspector";
import { saveVisualDesign } from "./design-actions";
import { frameChannel, isScreen, type SimulatorScreen, screens } from "./simulator";
import styles from "./visual-designer.module.css";

const devices = [
  [360, "Telefon 360"],
  [390, "Telefon 390"],
  [412, "Telefon 412"],
  [768, "Tablet 768"],
  [1280, "Računar 1280"],
] as const;
const variants: readonly [DesignVariant, string][] = [
  ["base", "Svi ekrani"],
  ["mobile", "Telefon"],
  ["dark", "Tamna tema"],
  ["mobileDark", "Telefon u tamnoj temi"],
];
function firstTarget(screen: SimulatorScreen) {
  return {
    home: "home-hero",
    search: "search-form",
    business: "business-profile",
    auth: "auth-form",
    account: "account-panel",
    profile: "personal-profile",
    messages: "messages-panel",
    booking: "booking-panel",
    admin: "admin-panel",
  }[screen];
}
function same(a: VisualDesign, b: VisualDesign) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function validate(design: VisualDesign) {
  try {
    return parseVisualDesign(design);
  } catch {
    return null;
  }
}

export function VisualDesigner({ initial, actor }: { initial: VisualDesignState; actor: string }) {
  const [saved, setSaved] = useState(initial),
    [design, setDesign] = useState(initial.draft),
    [history, setHistory] = useState<VisualDesign[]>([]);
  const [width, setWidth] = useState(390),
    [dark, setDark] = useState(false),
    [screen, setScreen] = useState<SimulatorScreen>("home"),
    [selected, setSelected] = useState("home-hero"),
    [inspect, setInspect] = useState(true);
  const [variant, setVariant] = useState<DesignVariant>("base"),
    [computed, setComputed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false),
    [confirm, setConfirm] = useState<"publish" | "reset" | null>(null);
  const [mobilePane, setMobilePane] = useState<"preview" | "edit">("preview");
  const [availableWidth, setAvailableWidth] = useState(390),
    [availableHeight, setAvailableHeight] = useState(650),
    [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    device = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    busyGuard = useRef(false);
  const validDesign = useMemo(() => validate(design), [design]);
  const dirty = validDesign ? !same(validDesign, saved.draft) : true;
  const unpublished = validDesign ? !same(validDesign, saved.published) : true;
  const scale = Math.min(1, Math.max(1, availableWidth) / width);
  const sendState = useCallback(() => {
    if (!validDesign || !frame.current?.contentWindow) return;
    frame.current.contentWindow.postMessage(
      {
        channel: frameChannel,
        type: "update",
        dark,
        screen,
        inspect,
        selected,
        design: validDesign,
      },
      window.location.origin,
    );
  }, [validDesign, dark, screen, inspect, selected]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        !frame.current ||
        event.source !== frame.current.contentWindow ||
        event.origin !== window.location.origin ||
        event.data?.channel !== frameChannel
      )
        return;
      const msg = event.data;
      if (msg.type === "ready") {
        setReady(true);
        sendState();
      }
      if (msg.type === "select" && designTargets.some((t) => t.id === msg.id)) {
        setSelected(msg.id);
        setComputed({});
        setMobilePane("edit");
      }
      if (msg.type === "navigate" && isScreen(msg.screen)) {
        setScreen(msg.screen);
        setSelected(firstTarget(msg.screen));
      }
      if (
        msg.type === "computed" &&
        msg.id === selected &&
        msg.values &&
        typeof msg.values === "object"
      ) {
        const properties: Record<string, string> = {};
        for (const { name } of designProperties)
          if (typeof msg.values[name] === "string" && msg.values[name].length < 400)
            properties[name] = msg.values[name];
        setComputed(properties);
      }
    }
    window.addEventListener("message", receive);
    sendState();
    return () => window.removeEventListener("message", receive);
  }, [sendState, selected]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el && entry.contentRect.width)
          setAvailableWidth(entry.contentRect.width);
        if (entry.target === device.current && entry.contentRect.height)
          setAvailableHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    if (device.current) observer.observe(device.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    function leaving(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);
  function edit(next: VisualDesign) {
    if (busyGuard.current || same(next, design)) return;
    setHistory((h) => [...h.slice(-39), design]);
    setDesign(next);
    setConfirm(null);
    setNotice("");
  }
  function undo() {
    const last = history.at(-1);
    if (last && !busyGuard.current) {
      setDesign(last);
      setHistory(history.slice(0, -1));
      setConfirm(null);
      setNotice("");
    }
  }
  function chooseScreen(next: SimulatorScreen) {
    setScreen(next);
    setSelected(firstTarget(next));
    setComputed({});
  }
  function chooseTarget(id: string) {
    const target = designTargets.find((t) => t.id === id);
    if (!target) return;
    setSelected(id);
    setComputed({});
    setInspect(true);
    if (
      target.screen !== "global" &&
      !(screen === "home" && target.screen === "search" && id.startsWith("directory-"))
    )
      setScreen(target.screen);
  }
  function chooseVariant(next: DesignVariant) {
    setVariant(next);
    if (next === "mobile" || next === "mobileDark") {
      if (width > 760) setWidth(390);
    }
    if (next === "dark" || next === "mobileDark") setDark(true);
    if (next === "mobile") setDark(false);
  }
  async function save(mode: "draft" | "publish") {
    if (!validDesign || busyGuard.current || conflict) return;
    busyGuard.current = true;
    setBusy(true);
    setConfirm(null);
    setNotice("");
    try {
      const result = await saveVisualDesign(actor, saved.revision, validDesign, mode);
      if (result.ok) {
        setSaved(result.state);
        setDesign(result.state.draft);
        setNotice(mode === "draft" ? "Nacrt je sačuvan." : "Izgled je objavljen.");
      } else {
        setConflict(Boolean(result.conflict));
        setNotice(result.message);
      }
    } catch {
      setNotice("Veza je prekinuta. Provjeri nacrt prije ponovnog spremanja.");
    } finally {
      setBusy(false);
      busyGuard.current = false;
    }
  }
  return (
    <main id="glavni-sadrzaj" className={styles.editor}>
      <header className={styles.head}>
        <div>
          <a href="/administracija">Administracija</a>
          <h1>Uređivač izgleda</h1>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            aria-label="Poništi posljednju izmjenu"
            title="Poništi posljednju izmjenu"
            disabled={!history.length || busy}
            onClick={undo}
          >
            ↶
          </button>
          <button
            type="button"
            disabled={busy || !dirty || !validDesign || conflict}
            onClick={() => void save("draft")}
          >
            Sačuvaj nacrt
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !unpublished || !validDesign || conflict}
            onClick={() => setConfirm("publish")}
          >
            Objavi izgled
          </button>
        </div>
      </header>
      <div className={styles.status} role="status">
        {busy
          ? "Spremanje…"
          : notice ||
            (!validDesign
              ? "Provjeri dužinu teksta, prelome reda i glavni naslov."
              : dirty
                ? "Nespremljene izmjene"
                : unpublished
                  ? "Sačuvani nacrt"
                  : "Trenutno objavljeni izgled")}
        {conflict && (
          <button type="button" onClick={() => location.reload()}>
            Učitaj noviji nacrt
          </button>
        )}
      </div>
      {confirm && (
        <section className={styles.confirm} aria-label="Potvrda izmjene">
          <p>
            {confirm === "publish"
              ? "Objaviti ovaj izgled svim korisnicima?"
              : "Vratiti osnovni izgled u radni nacrt?"}
          </p>
          <button type="button" onClick={() => setConfirm(null)}>
            Odustani
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              if (confirm === "publish") void save("publish");
              else {
                edit(defaultVisualDesign());
                setConfirm(null);
              }
            }}
          >
            {confirm === "publish" ? "Potvrdi objavu" : "Vrati osnovni izgled"}
          </button>
        </section>
      )}
      <div className={styles.toolbar}>
        <label>
          Ekran
          <select
            aria-label="Ekran"
            value={screen}
            onChange={(e) => {
              if (isScreen(e.target.value)) chooseScreen(e.target.value);
            }}
          >
            {screens.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Uređaj
          <select
            aria-label="Uređaj"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            {devices.map(([n, label]) => (
              <option key={n} value={n}>
                {label} px
              </option>
            ))}
          </select>
        </label>
        <label>
          Tema
          <select
            aria-label="Tema"
            value={dark ? "dark" : "light"}
            onChange={(e) => setDark(e.target.value === "dark")}
          >
            <option value="light">Svijetla</option>
            <option value="dark">Tamna</option>
          </select>
        </label>
        <div className={styles.segment}>
          <button type="button" aria-pressed={inspect} onClick={() => setInspect(true)}>
            Odaberi element
          </button>
          <button type="button" aria-pressed={!inspect} onClick={() => setInspect(false)}>
            Isprobaj ekran
          </button>
        </div>
      </div>
      <nav className={styles.mobileNav} aria-label="Prikaz uređivača">
        <button
          type="button"
          aria-pressed={mobilePane === "preview"}
          onClick={() => setMobilePane("preview")}
        >
          Simulator
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "edit"}
          onClick={() => setMobilePane("edit")}
        >
          Uređivanje
        </button>
      </nav>
      <div className={styles.workspace} data-pane={mobilePane}>
        <section className={styles.stage} aria-label="Simulator aplikacije">
          <div className={styles.stageLabel}>
            <span>{screens.find(([id]) => id === screen)?.[1]}</span>
            <span>{width} px</span>
          </div>
          <div ref={canvas} className={styles.canvas}>
            <div ref={device} className={styles.device} style={{ width: width * scale }}>
              <iframe
                ref={frame}
                src={designerFramePath}
                title="Simulator AhiBizz aplikacije"
                sandbox="allow-scripts allow-same-origin"
                onLoad={sendState}
                style={{
                  width,
                  height: availableHeight / scale,
                  transform: `scale(${scale})`,
                }}
              />
            </div>
          </div>
          {!ready && <p role="status">Povezivanje simulatora…</p>}
        </section>
        <aside className={styles.inspector} aria-label="Svojstva izgleda">
          <h2>Svojstva</h2>
          <label className={styles.textField}>
            Element
            <select
              aria-label="Element"
              value={selected}
              onChange={(e) => chooseTarget(e.target.value)}
            >
              {designTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.textField}>
            Primijeni na
            <select
              aria-label="Primijeni na"
              value={variant}
              onChange={(e) => chooseVariant(e.target.value as DesignVariant)}
            >
              {variants.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy}>
            <StyleInspector
              target={selected}
              variant={variant}
              design={design}
              computed={computed}
              change={edit}
            />
            {screen === "home" && <HomeEditor design={design} change={edit} />}
          </fieldset>
          <button
            type="button"
            className={styles.reset}
            disabled={busy}
            onClick={() => setConfirm("reset")}
          >
            Vrati osnovni izgled
          </button>
        </aside>
      </div>
    </main>
  );
}
