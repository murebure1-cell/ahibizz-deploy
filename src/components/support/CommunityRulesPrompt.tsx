"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMMUNITY_RULES_VERSION, communityRules } from "../../lib/community-rules";
import { useT } from "../i18n/LocaleProvider";
import styles from "./community-rules.module.css";

export function CommunityRulesPrompt({ actor }: { actor: string }) {
  const t = useT();
  const [state, setState] = useState<"loading" | "needed" | "done" | "failed" | "stale">("loading");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const read = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState("loading");
    fetch("/api/community-rules", {
      headers: { "X-AhiBizz-Account-ID": actor },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) {
          if (result.version !== COMMUNITY_RULES_VERSION) setState("stale");
          else setState(result.accepted ? "done" : "needed");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("failed");
      });
  }, [actor]);
  useEffect(() => {
    read();
    return () => pending.current?.abort();
  }, [read]);

  async function accept() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/community-rules", {
        method: "POST",
        cache: "no-store",
        headers: {
          "X-AhiBizz-Account-ID": actor,
          "X-AhiBizz-Community-Rules": COMMUNITY_RULES_VERSION,
        },
      });
      if (response.status === 409) {
        setState("stale");
        return;
      }
      if (!response.ok || (await response.json()).accepted !== true) throw new Error();
      setState("done");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  if (state === "done" || state === "loading") return null;
  if (state === "failed" || state === "stale") {
    return (
      <aside className={styles.notice}>
        <p>
          {state === "stale"
            ? t("Pravila su ažurirana.")
            : t("Provjera pravila trenutno nije dostupna.")}
        </p>
        <button
          type="button"
          className="button secondary"
          onClick={state === "stale" ? () => window.location.reload() : read}
        >
          {state === "stale" ? t("Učitaj nova pravila") : t("Pokušaj ponovo")}
        </button>
      </aside>
    );
  }
  return (
    <aside className={styles.notice} aria-label={t("Pravila zajednice")}>
      <details>
        <summary>{t("Pravila za objave i poruke")}</summary>
        {communityRules.map((rule) => (
          <p key={rule}>{t(rule)}</p>
        ))}
        <Link href="/pravila-zajednice">{t("Otvori pravila zajednice")}</Link>
      </details>
      <button type="button" className="button secondary" disabled={busy} onClick={accept}>
        {t("Prihvatam pravila")}
      </button>
    </aside>
  );
}
