"use client";

import Link from "next/link";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  type AccountAuthorityState,
  createAccountAuthorityBoundary,
} from "../../lib/account-authority";
import { accountSettingsRequest } from "../../lib/account-settings";
import type { SafeAccountProfile } from "../../server/auth/accounts";
import { useT } from "../i18n/LocaleProvider";
import styles from "./authority.module.css";

/**
 * Conceals visible and accessibility content during a browser/account boundary.
 * Children intentionally remain mounted: unsent drafts and uncertain commands are
 * retained in this page's memory, not purged from the hidden DOM or JavaScript heap.
 */
export function AccountAuthorityBoundary({
  expectedAccountId,
  expectedRole,
  request = accountSettingsRequest,
  loginHref = "/prijava?nastavi=%2Fnalog",
  onConfirmed,
  children,
}: {
  expectedAccountId: string;
  expectedRole?: SafeAccountProfile["role"];
  request?: typeof accountSettingsRequest;
  loginHref?: string;
  onConfirmed?: (account: SafeAccountProfile) => void;
  children: (active: boolean) => ReactNode;
}) {
  const t = useT();
  const [state, setState] = useState<AccountAuthorityState>({
    visible: true,
    checking: false,
    denied: false,
    unavailable: false,
  });
  const content = useRef<HTMLDivElement>(null),
    notice = useRef<HTMLElement>(null),
    boundary = useRef<ReturnType<typeof createAccountAuthorityBoundary> | null>(null),
    initialized = useRef(false),
    previousVisible = useRef(true),
    scrollPosition = useRef<{ x: number; y: number } | null>(null),
    confirmed = useRef(onConfirmed);
  confirmed.current = onConfirmed;

  useLayoutEffect(() => {
    const first = !initialized.current;
    initialized.current = true;
    const apply = (next: AccountAuthorityState) => {
      if (previousVisible.current && !next.visible)
        scrollPosition.current = { x: window.scrollX, y: window.scrollY };
      // Native lifecycle events conceal synchronously, before React's batched render.
      if (content.current) {
        content.current.hidden = !next.visible;
        content.current.inert = !next.visible;
        content.current.style.display = next.visible ? "" : "none";
        content.current.setAttribute("aria-hidden", String(!next.visible));
      }
      if (notice.current) notice.current.hidden = next.visible;
      if (next.visible && !previousVisible.current && scrollPosition.current)
        window.scrollTo({
          left: scrollPosition.current.x,
          top: scrollPosition.current.y,
          behavior: "instant",
        });
      previousVisible.current = next.visible;
      setState(next);
    };
    const current = createAccountAuthorityBoundary({
      accountId: expectedAccountId,
      expectedRole,
      request,
      initialVisible: first,
      changed: apply,
      confirmed: (account) => confirmed.current?.(account),
    });
    boundary.current = current;
    const conceal = () => current.conceal();
    const reveal = () => {
      if (document.visibilityState !== "hidden") void current.revalidate();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") conceal();
      else reveal();
    };
    window.addEventListener("blur", conceal);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("focus", reveal);
    window.addEventListener("pageshow", reveal);
    document.addEventListener("visibilitychange", visibility);
    if (document.visibilityState === "hidden" || !first) {
      conceal();
      reveal();
    }
    return () => {
      current.dispose();
      if (boundary.current === current) boundary.current = null;
      window.removeEventListener("blur", conceal);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("focus", reveal);
      window.removeEventListener("pageshow", reveal);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [expectedAccountId, expectedRole, request]);

  return (
    <>
      <section
        ref={notice}
        className={styles.notice}
        hidden={state.visible}
        aria-label={t("Pristup nalogu")}
        aria-busy={state.checking}
      >
        <h1>{t("Moj nalog")}</h1>
        <p role="status">
          {state.checking
            ? t("Provjeravam prijavu…")
            : state.denied
              ? t("Prijavi se ponovo svojim nalogom.")
              : state.unavailable
                ? t("Prijavu trenutno nije moguće potvrditi.")
                : t("Potvrdi prijavu za nastavak.")}
        </p>
        <div>
          <button
            type="button"
            disabled={state.checking}
            onClick={() => void boundary.current?.revalidate()}
          >
            {t("Provjeri prijavu")}
          </button>
          <Link href={loginHref} target="_blank" rel="noopener noreferrer">
            {t("Prijavi se ponovo")}
          </Link>
        </div>
      </section>
      <div
        ref={content}
        hidden={!state.visible}
        inert={!state.visible}
        aria-hidden={!state.visible}
        style={state.visible ? undefined : { display: "none" }}
      >
        {children(state.visible)}
      </div>
    </>
  );
}
