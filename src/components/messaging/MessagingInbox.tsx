"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatConversation,
  type ChatMessage,
  type ChatReceipt,
  type ChatThread,
  type ChatThreadPage,
  conversationReadThrough,
  type MessageInbox,
  type MessageTarget,
  normalizeMessageBody,
  readChatConversation,
  readChatReceipt,
  readChatThreadPage,
} from "../../lib/messaging";
import {
  type MessagingRequest,
  MessagingRequestError,
  messagingError,
  messagingRequest,
  messagingWrite,
} from "../../lib/messaging-client";
import { Icon } from "../Icon";
import styles from "./messaging.module.css";

type Intent = {
  action: "open" | "send" | "block";
  path: string;
  body: Record<string, unknown>;
  key: string;
  threadId: string | null;
  target?: MessageTarget;
  receipt?: ChatReceipt;
};
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase("bs");
}
function time(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
const months = [
  "januar",
  "februar",
  "mart",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "septembar",
  "oktobar",
  "novembar",
  "decembar",
];
function day(value: string) {
  const date = new Date(value);
  return `${date.getDate()}. ${months[date.getMonth()]}`;
}
function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(previous.map((message) => [message.sequence, message]));
  for (const message of incoming) {
    const prior = messages.get(message.sequence);
    if (
      prior &&
      (prior.id !== message.id || prior.body !== message.body || prior.from !== message.from)
    )
      throw new Error("invalid_message_history");
    messages.set(message.sequence, message);
  }
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}

export function MessagingInbox({
  active = true,
  preview = false,
  request = messagingRequest,
  initialTarget,
  heading = true,
  onSimulateReply,
}: {
  active?: boolean;
  preview?: boolean;
  request?: MessagingRequest;
  initialTarget?: MessageTarget;
  heading?: boolean;
  onSimulateReply?: (threadId: string) => void | Promise<void>;
}) {
  const [inbox, setInbox] = useState<MessageInbox>("personal");
  const [page, setPage] = useState(1);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listReady, setListReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [reading, setReading] = useState(false);
  const [older, setOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Intent | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const scope = useRef(0);
  const listRevision = useRef(0);
  const conversationRevision = useRef(0);
  const appliedRevision = useRef(0);
  const writing = useRef(false);
  const pendingRef = useRef<Intent | null>(null);
  const selection = useRef<string | null>(null);
  const view = useRef({ inbox, page });
  const enabled = useRef(active);
  const listCache = useRef(new Map<string, ChatThreadPage>());
  const conversationCache = useRef(new Map<string, ChatConversation>());
  const handledTarget = useRef("");
  const controllers = useRef(new Set<AbortController>());
  const previousTransport = useRef({ request, preview });
  const scroll = useRef<HTMLDivElement | null>(null);
  const previousLast = useRef<string | null>(null);
  view.current = { inbox, page };
  enabled.current = active;
  const usable = !(preview && request === messagingRequest);

  const clearPrivate = useCallback((resetTarget = false) => {
    scope.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    listCache.current.clear();
    conversationCache.current.clear();
    selection.current = null;
    pendingRef.current = null;
    writing.current = false;
    if (resetTarget) handledTarget.current = "";
    setSelected(null);
    setConversation(null);
    setThreads([]);
    setHasMore(false);
    setListReady(false);
    setDraft("");
    setPending(null);
    setBusy(false);
    setLoading(false);
    setReading(false);
    setOlder(false);
  }, []);
  const fail = useCallback(
    (failure: unknown) => {
      if (failure instanceof MessagingRequestError && [401, 403, 404].includes(failure.status))
        clearPrivate();
      setError(messagingError(failure));
    },
    [clearPrivate],
  );
  const updateThread = useCallback((thread: ChatThread) => {
    for (const [key, value] of listCache.current) {
      listCache.current.set(key, {
        ...value,
        items: value.items.map((item) => (item.id === thread.id ? thread : item)),
      });
    }
    setThreads((items) => items.map((item) => (item.id === thread.id ? thread : item)));
  }, []);

  const loadList = useCallback(
    async (selectedInbox: MessageInbox, selectedPage: number, quiet = false) => {
      if (!usable) {
        setError("Pregled poruka trenutno nije dostupan.");
        return;
      }
      const generation = scope.current,
        ticket = ++listRevision.current;
      const key = `${selectedInbox}:${selectedPage}`,
        cached = listCache.current.get(key);
      if (!quiet) {
        setThreads(cached?.items ?? []);
        setHasMore(cached?.hasMore ?? false);
        setListReady(Boolean(cached));
        setLoading(true);
      }
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const value = readChatThreadPage(
          await request(`threads?inbox=${selectedInbox}&page=${selectedPage}`, {
            signal: controller.signal,
          }),
        );
        if (
          value.page !== selectedPage ||
          value.items.some((thread) => thread.inbox !== selectedInbox)
        )
          throw new Error("invalid_message_inbox");
        if (
          !alive.current ||
          controller.signal.aborted ||
          scope.current !== generation ||
          ticket !== listRevision.current
        )
          return;
        listCache.current.set(key, value);
        if (view.current.inbox === selectedInbox && view.current.page === selectedPage) {
          setThreads(value.items);
          setHasMore(value.hasMore);
          setListReady(true);
        }
      } catch (failure) {
        if (
          alive.current &&
          !controller.signal.aborted &&
          scope.current === generation &&
          ticket === listRevision.current
        )
          fail(failure);
      } finally {
        controllers.current.delete(controller);
        if (alive.current && scope.current === generation && ticket === listRevision.current)
          setLoading(false);
      }
    },
    [fail, request, usable],
  );

  const loadConversation = useCallback(
    async (id: string, before?: number, acknowledge = true): Promise<ChatConversation | null> => {
      if (!usable) return null;
      const generation = scope.current,
        ticket = ++conversationRevision.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      if (before) setOlder(true);
      else if (!conversationCache.current.has(id)) setReading(true);
      try {
        const value = readChatConversation(
          await request(`threads/${id}${before ? `?before=${before}` : ""}`, {
            signal: controller.signal,
          }),
        );
        const readThrough = conversationReadThrough(value, before);
        if (
          value.thread.id !== id ||
          (before !== undefined && value.items.some((message) => message.sequence >= before))
        )
          throw new Error("invalid_message_conversation");
        if (
          !alive.current ||
          controller.signal.aborted ||
          scope.current !== generation ||
          selection.current !== id
        )
          return null;
        const cached = conversationCache.current.get(id);
        const newerMetadata =
          ticket >= appliedRevision.current &&
          (!cached || value.thread.latestSequence >= cached.thread.latestSequence);
        const next: ChatConversation = {
          thread: newerMetadata ? value.thread : (cached?.thread ?? value.thread),
          items: mergeMessages(cached?.items ?? [], value.items),
          hasMore: before
            ? value.hasMore
            : cached &&
                (cached.items[0]?.sequence ?? Infinity) < (value.items[0]?.sequence ?? Infinity)
              ? cached.hasMore
              : value.hasMore,
        };
        if (newerMetadata) appliedRevision.current = ticket;
        conversationCache.current.set(id, next);
        setConversation(next);
        updateThread(next.thread);
        setReading(false);
        if (
          acknowledge &&
          readThrough !== null &&
          enabled.current &&
          document.visibilityState === "visible" &&
          next.thread.unreadCount > 0
        ) {
          const result = await request(
            `threads/${id}/read`,
            messagingWrite({ throughSequence: readThrough }),
          );
          if (
            !Number.isInteger(result.readSequence) ||
            (result.readSequence as number) < readThrough
          )
            throw new Error("unconfirmed_message_read");
          if (!alive.current || scope.current !== generation || selection.current !== id)
            return next;
          const current = conversationCache.current.get(id);
          if (current && (result.readSequence as number) <= current.thread.latestSequence) {
            const readSequence = Math.max(
              current.thread.readSequence,
              result.readSequence as number,
            );
            const marked = {
              ...current,
              thread: {
                ...current.thread,
                readSequence,
                unreadCount: current.items.filter(
                  (message) => message.from === "peer" && message.sequence > readSequence,
                ).length,
              },
            };
            conversationCache.current.set(id, marked);
            setConversation(marked);
            updateThread(marked.thread);
            return marked;
          }
        }
        return next;
      } catch (failure) {
        if (
          alive.current &&
          !controller.signal.aborted &&
          scope.current === generation &&
          selection.current === id
        )
          fail(failure);
        return null;
      } finally {
        controllers.current.delete(controller);
        if (alive.current && scope.current === generation) {
          if (before) setOlder(false);
          else setReading(false);
        }
      }
    },
    [fail, request, updateThread, usable],
  );

  const commit = useCallback(
    async (intent: Intent) => {
      if (!usable || writing.current) return;
      const generation = scope.current;
      writing.current = true;
      setBusy(true);
      setError("");
      pendingRef.current = intent;
      setPending(intent);
      try {
        const receipt =
          intent.receipt ??
          readChatReceipt(
            (await request(intent.path, messagingWrite(intent.body, intent.key))).receipt,
          );
        if (
          (intent.threadId && receipt.threadId !== intent.threadId) ||
          (intent.action === "send" ? receipt.messageId === null : receipt.messageId !== null)
        )
          throw new Error("unconfirmed_message_action");
        if (!alive.current || scope.current !== generation) return;
        const acknowledged = { ...intent, receipt };
        pendingRef.current = acknowledged;
        setPending(acknowledged);
        selection.current = receipt.threadId;
        setSelected(receipt.threadId);
        const fresh = await loadConversation(receipt.threadId, undefined, false);
        if (!fresh || !alive.current || scope.current !== generation) return;
        if (
          intent.target &&
          (fresh.thread.kind !== intent.target.kind ||
            fresh.thread.targetId !== intent.target.targetId)
        )
          throw new Error("unconfirmed_message_target");
        if (
          intent.action === "send" &&
          receipt.sequence &&
          fresh.thread.latestSequence < receipt.sequence
        )
          throw new Error("unconfirmed_message_action");
        pendingRef.current = null;
        setPending(null);
        if (intent.action === "send") setDraft("");
        setInbox(fresh.thread.inbox);
        setPage(1);
        view.current = { inbox: fresh.thread.inbox, page: 1 };
        await loadList(fresh.thread.inbox, 1, true);
        if (enabled.current && document.visibilityState === "visible")
          await loadConversation(receipt.threadId);
      } catch (failure) {
        if (!alive.current || scope.current !== generation) return;
        fail(failure);
        if (
          !intent.receipt &&
          failure instanceof MessagingRequestError &&
          failure.status >= 400 &&
          failure.status < 500
        ) {
          pendingRef.current = null;
          setPending(null);
        }
      } finally {
        if (alive.current && scope.current === generation) {
          writing.current = false;
          setBusy(false);
        }
      }
    },
    [fail, loadConversation, loadList, request, usable],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      scope.current++;
      for (const controller of controllers.current) controller.abort();
    };
  }, []);
  useEffect(() => {
    if (
      previousTransport.current.request !== request ||
      previousTransport.current.preview !== preview
    ) {
      previousTransport.current = { request, preview };
      clearPrivate(true);
      setError("");
    }
  }, [clearPrivate, request, preview]);
  useEffect(() => {
    if (active) void loadList(inbox, page);
    return () => {
      for (const controller of controllers.current) controller.abort();
    };
  }, [active, inbox, loadList, page]);
  const targetKey = initialTarget ? `${initialTarget.kind}:${initialTarget.targetId}` : "";
  useEffect(() => {
    if (
      !active ||
      !initialTarget ||
      !usable ||
      pending ||
      busy ||
      handledTarget.current === targetKey
    )
      return;
    handledTarget.current = targetKey;
    void commit({
      action: "open",
      path: "threads",
      body: { ...initialTarget },
      target: { ...initialTarget },
      key: crypto.randomUUID(),
      threadId: null,
    });
  }, [active, busy, commit, initialTarget, pending, targetKey, usable]);
  useEffect(() => {
    if (!active || !usable) return;
    const refresh = () => {
      if (document.visibilityState !== "visible" || writing.current || pendingRef.current) return;
      void loadList(view.current.inbox, view.current.page, true);
      if (selection.current) void loadConversation(selection.current);
    };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, loadConversation, loadList, usable]);
  useEffect(() => {
    const last = conversation?.items.at(-1)?.id ?? null;
    if (last && last !== previousLast.current)
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
    previousLast.current = last;
  }, [conversation]);

  function choose(thread: ChatThread) {
    if (busy || pending) return;
    selection.current = thread.id;
    setSelected(thread.id);
    setDraft("");
    setError("");
    setConversation(conversationCache.current.get(thread.id) ?? null);
    void loadConversation(thread.id);
  }
  function switchInbox(next: MessageInbox) {
    if (next === inbox || busy || pending) return;
    selection.current = null;
    setSelected(null);
    setConversation(null);
    setDraft("");
    setError("");
    setInbox(next);
    setPage(1);
    view.current = { inbox: next, page: 1 };
    const cached = listCache.current.get(`${next}:1`);
    setThreads(cached?.items ?? []);
    setHasMore(cached?.hasMore ?? false);
    setListReady(Boolean(cached));
  }
  function refresh() {
    if (busy || pending) return;
    setError("");
    void loadList(inbox, page, true);
    if (selection.current) void loadConversation(selection.current);
  }
  function send() {
    if (!conversation?.thread.canSend || busy || pending) return;
    try {
      const body = normalizeMessageBody(draft);
      void commit({
        action: "send",
        path: `threads/${conversation.thread.id}/messages`,
        body: { body },
        threadId: conversation.thread.id,
        key: crypto.randomUUID(),
      });
    } catch {
      setError("Napiši poruku do 2.000 znakova.");
    }
  }
  const thread = conversation?.thread;
  return (
    <section className={styles.workspace} aria-label="Poruke">
      {heading && (
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>TVOJ PROSTOR</span>
            <h1>Poruke</h1>
          </div>
          <button
            type="button"
            className={styles.refresh}
            onClick={refresh}
            disabled={busy || Boolean(pending) || !usable}
          >
            Osvježi
          </button>
        </header>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {pending && (
        <div role="status" className={styles.pending}>
          <span>
            {pending.receipt
              ? "Promjena je primljena. Provjeri razgovor."
              : "Zahtjev nije potvrđen. Provjeri prije nove poruke."}
          </span>
          <button type="button" disabled={busy} onClick={() => void commit(pending)}>
            {busy ? "Provjeravam…" : "Provjeri"}
          </button>
        </div>
      )}
      <div className={`${styles.layout} ${selected ? styles.hasSelection : ""}`}>
        <aside className={styles.sidebar} aria-label="Razgovori">
          <div className={styles.tabs} role="tablist" aria-label="Sandučić">
            {(
              [
                ["personal", "Lično"],
                ["business", "Djelatnosti"],
              ] as const
            ).map(([value, label]) => (
              <button
                role="tab"
                aria-selected={inbox === value}
                type="button"
                key={value}
                onClick={() => switchInbox(value)}
                disabled={busy || Boolean(pending)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.threadList} aria-busy={loading}>
            {threads.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.thread} ${selected === item.id ? styles.selected : ""}`}
                aria-current={selected === item.id ? "true" : undefined}
                onClick={() => choose(item)}
                disabled={busy || Boolean(pending)}
              >
                <span className={styles.avatar} aria-hidden="true">
                  {item.kind === "business" ? <Icon name="shop" /> : initials(item.title)}
                </span>
                <span className={styles.threadBody}>
                  <strong>{item.title}</strong>
                  <span>{item.lastMessage?.body ?? "Započni razgovor"}</span>
                </span>
                <span className={styles.threadMeta}>
                  {item.lastMessage && (
                    <time dateTime={item.lastMessage.createdAt}>
                      {time(item.lastMessage.createdAt)}
                    </time>
                  )}
                  {item.unreadCount > 0 && (
                    <span className={styles.unread}>
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                      <span className={styles.srOnly}> nepročitanih poruka</span>
                    </span>
                  )}
                </span>
              </button>
            ))}
            {threads.length === 0 && (
              <div className={styles.listEmpty}>
                <Icon name={inbox === "business" ? "shop" : "message"} />
                <strong>{loading && !listReady ? "Otvaram poruke…" : "Još nema razgovora"}</strong>
                {!(loading && !listReady) && (
                  <span>
                    {inbox === "business"
                      ? "Ovdje stižu upiti za tvoje djelatnosti."
                      : "Javi se osobi ili djelatnosti s njenog profila."}
                  </span>
                )}
              </div>
            )}
          </div>
          {(page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label="Stranice razgovora">
              <button
                type="button"
                disabled={page === 1 || busy || Boolean(pending)}
                onClick={() => setPage(page - 1)}
              >
                Prethodna
              </button>
              <span>{page}</span>
              <button
                type="button"
                disabled={!hasMore || busy || Boolean(pending)}
                onClick={() => setPage(page + 1)}
              >
                Sljedeća
              </button>
            </nav>
          )}
        </aside>
        <section
          className={styles.conversation}
          aria-label={thread ? `Razgovor: ${thread.title}` : "Izabrani razgovor"}
        >
          {selected ? (
            <>
              <header className={styles.conversationHeader}>
                <button
                  type="button"
                  className={styles.back}
                  aria-label="Nazad na razgovore"
                  disabled={busy || Boolean(pending)}
                  onClick={() => {
                    selection.current = null;
                    setSelected(null);
                    setConversation(null);
                    setDraft("");
                  }}
                >
                  <Icon name="arrow" />
                </button>
                <span className={styles.avatar} aria-hidden="true">
                  {thread?.kind === "business" ? (
                    <Icon name="shop" />
                  ) : (
                    initials(thread?.title ?? "")
                  )}
                </span>
                <div className={styles.conversationTitle}>
                  <h2>{thread?.title ?? "Razgovor"}</h2>
                  <span>
                    {thread?.kind === "business" ? "Poslovni razgovor" : "Lični razgovor"}
                  </span>
                </div>
                {thread && (
                  <button
                    type="button"
                    className={styles.block}
                    disabled={busy || Boolean(pending)}
                    onClick={() =>
                      void commit({
                        action: "block",
                        path: `threads/${thread.id}/block`,
                        body: { blocked: !thread.blockedByMe },
                        threadId: thread.id,
                        key: crypto.randomUUID(),
                      })
                    }
                  >
                    {thread.blockedByMe ? "Odblokiraj" : "Blokiraj"}
                  </button>
                )}
              </header>
              <div
                ref={scroll}
                className={styles.messages}
                role="log"
                aria-label="Historija poruka"
                aria-live="polite"
                aria-busy={reading}
              >
                {conversation?.hasMore && (
                  <button
                    type="button"
                    className={styles.older}
                    disabled={older || busy || Boolean(pending)}
                    onClick={() => void loadConversation(selected, conversation.items[0]?.sequence)}
                  >
                    {older ? "Otvaram…" : "Starije poruke"}
                  </button>
                )}
                {reading && !conversation && <p className={styles.centerNote}>Otvaram razgovor…</p>}
                {conversation?.items.map((message, index) => (
                  <div key={message.id}>
                    {(index === 0 ||
                      conversation.items[index - 1]?.createdAt.slice(0, 10) !==
                        message.createdAt.slice(0, 10)) && (
                      <div className={styles.day}>{day(message.createdAt)}</div>
                    )}
                    <div
                      className={`${styles.messageRow} ${message.from === "me" ? styles.fromMe : ""}`}
                    >
                      <div className={styles.bubble}>
                        <p>{message.body}</p>
                        <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
                      </div>
                    </div>
                  </div>
                ))}
                {conversation && conversation.items.length === 0 && (
                  <div className={styles.emptyConversation}>
                    <Icon name="message" />
                    <strong>Razgovor počinje ovdje</strong>
                    <span>Pošalji prvu poruku.</span>
                  </div>
                )}
              </div>
              {thread && !thread.canSend && (
                <p className={styles.blocked}>
                  {thread.blocked ? "Razgovor je blokiran." : "Nove poruke trenutno nisu dostupne."}
                </p>
              )}
              {preview && onSimulateReply && thread && (
                <button
                  type="button"
                  className={styles.simulate}
                  disabled={busy || Boolean(pending) || !thread.canSend}
                  onClick={async () => {
                    try {
                      await onSimulateReply(thread.id);
                      await loadConversation(thread.id);
                      await loadList(inbox, page, true);
                    } catch (failure) {
                      fail(failure);
                    }
                  }}
                >
                  Isprobaj odgovor
                </button>
              )}
              <form
                className={styles.composer}
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className={styles.srOnly} htmlFor={`message-${selected}`}>
                  Tvoja poruka
                </label>
                <textarea
                  id={`message-${selected}`}
                  rows={2}
                  maxLength={2000}
                  value={draft}
                  placeholder="Napiši poruku…"
                  disabled={!thread?.canSend || busy || Boolean(pending)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <button
                  type="submit"
                  className={styles.send}
                  aria-label="Pošalji poruku"
                  disabled={!thread?.canSend || !draft.trim() || busy || Boolean(pending)}
                >
                  <Icon name="arrow" />
                  <span>Pošalji</span>
                </button>
              </form>
            </>
          ) : (
            <div className={styles.welcome}>
              <span className={styles.welcomeIcon}>
                <Icon name="message" />
              </span>
              <h2>Tvoji razgovori, na jednom mjestu.</h2>
              <p>Izaberi razgovor s lijeve strane.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
