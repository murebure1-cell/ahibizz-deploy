"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { type MessageTarget, messageLink, readMessageTarget } from "../../lib/messaging";
import { MessagingInbox } from "../messaging/MessagingInbox";
import { useMessagingPreview } from "./MessagingPreviewState";
import styles from "./messaging-preview.module.css";

export function MessagingPreview({
  active = true,
  embedded = false,
}: {
  active?: boolean;
  embedded?: boolean;
}) {
  const { api, ready } = useMessagingPreview();
  const search = useSearchParams().toString();
  const [target, setTarget] = useState<MessageTarget | null>(null),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const read = () => {
      // Embedded account has its own navigation query; only the dedicated message route has a target.
      if (embedded) {
        setTarget(null);
        setInvalid(false);
        return;
      }
      try {
        setTarget(readMessageTarget(new URLSearchParams(search)));
        setInvalid(false);
      } catch {
        setTarget(null);
        setInvalid(true);
      }
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [embedded, search]);
  const content = (
    <>
      <nav className={styles.examples} aria-label="Isprobaj poruke">
        <span>Isprobaj razgovor</span>
        <Link href={messageLink({ kind: "person", targetId: "preview-designer" }, true)}>
          S osobom
        </Link>
        <Link href={messageLink({ kind: "business", targetId: "forma" }, true)}>S djelatnošću</Link>
      </nav>
      {invalid && (
        <p className={styles.error} role="alert">
          Link za razgovor nije ispravan.
        </p>
      )}
      {ready ? (
        <MessagingInbox
          active={active}
          heading={!embedded}
          preview
          request={api.request}
          initialTarget={target ?? undefined}
          onSimulateReply={async (id) => {
            await api.simulatePeerReply(
              id,
              "Hvala na poruci. Ovo je probni odgovor u tvom pregledu.",
            );
          }}
        />
      ) : (
        <section className={styles.placeholder} aria-busy="true" aria-label="Poruke" />
      )}
    </>
  );
  return embedded ? (
    <div>{content}</div>
  ) : (
    <main id="glavni-sadrzaj" className={`preview-container ${styles.page}`}>
      {content}
    </main>
  );
}
