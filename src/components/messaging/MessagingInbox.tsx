"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageDay as day } from "../../lib/display-date";
import {
  type ChatConversation,
  type ChatMessage,
  type ChatThread,
  type ChatThreadPage,
  conversationReadThrough,
  type MessageInbox,
  type MessageTarget,
  messageIdentifier,
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
import {
  messagingAccessDenied,
  messagingCommandNeedsRecovery,
} from "../../lib/messaging-command-state";
import {
  browserMessagingRecoveryStore,
  type MessagingIntent as Intent,
  type MessagingRecoveryStore,
  MessagingStorageError,
} from "../../lib/messaging-recovery-storage";
import { reportUrl } from "../../lib/support-requests";
import { Icon } from "../Icon";
import styles from "./messaging.module.css";

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
  expectedAccountId,
  recoveryStore,
}: {
  active?: boolean;
  preview?: boolean;
  request?: MessagingRequest;
  initialTarget?: MessageTarget;
  heading?: boolean;
  onSimulateReply?: (threadId: string) => void | Promise<void>;
  expectedAccountId?: string;
  /** Only isolated fixtures inject this; live persistence is bound to the signed account. */
  recoveryStore?: MessagingRecoveryStore;
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
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [authorityVerified, setAuthorityVerified] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const store = useMemo(
    () =>
      recoveryStore ??
      (!preview && request === messagingRequest && messageIdentifier(expectedAccountId)
        ? browserMessagingRecoveryStore(expectedAccountId)
        : null),
    [recoveryStore, preview, request, expectedAccountId],
  );
  const restored = useRef(false);
  const pendingInbox = useRef<MessageInbox>("personal");
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
  const draftCache = useRef(new Map<string, string>());
  const draftRevisions = useRef(new Map<string, string | null>());
  const unpersistedDrafts = useRef(new Set<string>());
  const handledTarget = useRef("");
  const controllers = useRef(new Set<AbortController>());
  const previousTransport = useRef({ request, preview, expectedAccountId });
  const scroll = useRef<HTMLDivElement | null>(null);
  const previousLast = useRef<string | null>(null);
  view.current = { inbox, page };
  enabled.current = active;
  const usable = messageIdentifier(expectedAccountId) && !(preview && request === messagingRequest);
  const scopedRequest = useCallback<MessagingRequest>(
    (path, options = {}) => {
      const headers = new Headers(options.headers);
      if (!messageIdentifier(expectedAccountId))
        return Promise.reject(new MessagingRequestError(401, "ACCOUNT_IDENTITY_CHANGED"));
      headers.set("X-AhiBizz-Account-ID", expectedAccountId);
      return request(path, { ...options, headers });
    },
    [expectedAccountId, request],
  );

  const clearPrivate = useCallback((resetTarget = false, preserveRecovery = false) => {
    const command = pendingRef.current;
    // A denied concurrent read cannot prove that a dispatched first write did not commit.
    const recovery =
      preserveRecovery && command && (command.uncertain || command.receipt || writing.current)
        ? { ...command, uncertain: true }
        : null;
    scope.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    listCache.current.clear();
    conversationCache.current.clear();
    draftCache.current.clear();
    draftRevisions.current.clear();
    unpersistedDrafts.current.clear();
    restored.current = false;
    setAuthorityVerified(false);
    setRecoveryReady(false);
    selection.current = null;
    pendingRef.current = recovery;
    writing.current = false;
    if (resetTarget) handledTarget.current = "";
    setSelected(null);
    setConversation(null);
    setThreads([]);
    setHasMore(false);
    setListReady(false);
    setDraft("");
    setPending(recovery);
    setBusy(false);
    setLoading(false);
    setReading(false);
    setOlder(false);
    setRequiresLogin(false);
  }, []);
  const fail = useCallback(
    (failure: unknown) => {
      if (failure instanceof MessagingRequestError && [401, 403, 404].includes(failure.status)) {
        if (failure.status === 404) {
          try {
            store?.clearSelection(selection.current);
          } catch {
            /* Private view still clears. */
          }
        }
        clearPrivate(false, true);
        if (failure.status !== 404) setRequiresLogin(true);
      }
      setError(
        failure instanceof MessagingStorageError
          ? "Nacrt se ne može sačuvati na uređaju. Oslobodi prostor pa pokušaj ponovo."
          : messagingError(failure),
      );
    },
    [clearPrivate, store],
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
          await scopedRequest(`threads?inbox=${selectedInbox}&page=${selectedPage}`, {
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
        setAuthorityVerified(true);
        setRequiresLogin(false);
        if (view.current.inbox === selectedInbox && view.current.page === selectedPage) {
          setThreads(value.items);
          setHasMore(value.hasMore);
          setListReady(true);
        }
      } catch (failure) {
        if (
          alive.current &&
          scope.current === generation &&
          (messagingAccessDenied(failure) ||
            (!controller.signal.aborted && ticket === listRevision.current))
        )
          fail(failure);
      } finally {
        controllers.current.delete(controller);
        if (alive.current && scope.current === generation && ticket === listRevision.current)
          setLoading(false);
      }
    },
    [fail, scopedRequest, usable],
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
          await scopedRequest(`threads/${id}${before ? `?before=${before}` : ""}`, {
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
        const draftKey = `${next.thread.inbox}:${id}`;
        if (!draftCache.current.has(draftKey)) {
          let saved = "";
          try {
            const value = store?.readDraftState(id, next.thread.inbox);
            saved = value?.text ?? "";
            draftRevisions.current.set(draftKey, value?.key ?? null);
          } catch {
            setStorageWarning("Nacrt se trenutno čuva samo dok je aplikacija otvorena.");
          }
          draftCache.current.set(draftKey, saved);
        }
        setDraft(draftCache.current.get(draftKey) ?? "");
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
          const result = await scopedRequest(
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
          scope.current === generation &&
          (messagingAccessDenied(failure) ||
            (!controller.signal.aborted && selection.current === id))
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
    [fail, scopedRequest, updateThread, usable, store],
  );

  const commit = useCallback(
    async (intent: Intent) => {
      if (!usable || writing.current) return;
      const generation = scope.current;
      const commandInbox =
        pendingRef.current?.key === intent.key ? pendingInbox.current : view.current.inbox;
      if (store && (!authorityVerified || !recoveryReady)) {
        // Explicit recovery after reauthentication first rechecks this exact actor.
        // It never replays a command merely because a background request succeeded.
        if (pendingRef.current?.key !== intent.key) return;
        writing.current = true;
        setBusy(true);
        try {
          const authority = readChatThreadPage(
            await scopedRequest(`threads?inbox=${commandInbox}&page=1`),
          );
          if (
            authority.page !== 1 ||
            authority.items.some((thread) => thread.inbox !== commandInbox)
          )
            throw Error("invalid_message_inbox");
          if (!alive.current || scope.current !== generation) return;
          restored.current = true;
          setAuthorityVerified(true);
          setRecoveryReady(true);
          setRequiresLogin(false);
        } catch (failure) {
          if (alive.current && scope.current === generation) fail(failure);
          return;
        } finally {
          if (alive.current && scope.current === generation) {
            writing.current = false;
            setBusy(false);
          }
        }
      }
      // Persist before dispatch: closing the app during POST must retain the same command key.
      try {
        const existing = store?.readPending();
        if (existing && existing.intent.key !== intent.key && !pendingRef.current) {
          pendingRef.current = existing.intent;
          pendingInbox.current = existing.inbox;
          setPending(existing.intent);
          return;
        }
        const durable = store?.savePending({ ...intent, uncertain: true }, commandInbox);
        if (durable?.receipt) intent = { ...intent, receipt: durable.receipt };
      } catch (failure) {
        fail(failure);
        return;
      }
      pendingInbox.current = commandInbox;
      writing.current = true;
      setBusy(true);
      setError("");
      pendingRef.current = intent;
      setPending(intent);
      try {
        const receipt =
          intent.receipt ??
          readChatReceipt(
            (await scopedRequest(intent.path, messagingWrite(intent.body, intent.key))).receipt,
          );
        if (
          (intent.threadId && receipt.threadId !== intent.threadId) ||
          (intent.action === "send" ? receipt.messageId === null : receipt.messageId !== null)
        )
          throw new Error("unconfirmed_message_action");
        if (!alive.current || scope.current !== generation) return;
        const acknowledged = { ...intent, receipt };
        // The earlier unknown journal is already sufficient if this write fails.
        pendingRef.current = acknowledged;
        setPending(acknowledged);
        store?.savePending(acknowledged, commandInbox);
        if (intent.action === "open" && selection.current !== receipt.threadId)
          setDraft(draftCache.current.get(`${commandInbox}:${receipt.threadId}`) ?? "");
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
        if (intent.action === "send") {
          // Clear only the matching sent draft before removing recovery, avoiding a crash gap.
          const remaining =
            store?.clearSentDraft(
              receipt.threadId,
              fresh.thread.inbox,
              intent.body.body as string,
              intent.key,
            ) ?? "";
          draftCache.current.set(`${fresh.thread.inbox}:${receipt.threadId}`, remaining);
          draftRevisions.current.set(
            `${fresh.thread.inbox}:${receipt.threadId}`,
            store?.readDraftState(receipt.threadId, fresh.thread.inbox).key ?? null,
          );
          if (selection.current === receipt.threadId) setDraft(remaining);
        }
        store?.completePending(intent.key, receipt);
        const nextPending = store?.readPending() ?? null;
        pendingRef.current = nextPending?.intent ?? null;
        pendingInbox.current = nextPending?.inbox ?? fresh.thread.inbox;
        setPending(nextPending?.intent ?? null);
        setRequiresLogin(false);
        setInbox(fresh.thread.inbox);
        setPage(1);
        view.current = { inbox: fresh.thread.inbox, page: 1 };
        await loadList(fresh.thread.inbox, 1, true);
        if (!alive.current || scope.current !== generation) return;
        if (enabled.current && document.visibilityState === "visible")
          await loadConversation(receipt.threadId);
      } catch (failure) {
        if (!alive.current || scope.current !== generation) return;
        const command = pendingRef.current?.key === intent.key ? pendingRef.current : intent;
        if (messagingCommandNeedsRecovery(command, failure)) {
          const recovery = { ...command, uncertain: true };
          pendingRef.current = recovery;
          setPending(recovery);
        } else {
          try {
            store?.clearPending(intent.key);
            const next = store?.readPending() ?? null;
            pendingRef.current = next?.intent ?? null;
            pendingInbox.current = next?.inbox ?? commandInbox;
            setPending(next?.intent ?? null);
          } catch (storageFailure) {
            const recovery = { ...command, uncertain: true };
            pendingRef.current = recovery;
            setPending(recovery);
            fail(storageFailure);
            return;
          }
        }
        fail(failure);
      } finally {
        if (alive.current && scope.current === generation) {
          writing.current = false;
          setBusy(false);
        }
      }
    },
    [
      fail,
      loadConversation,
      loadList,
      scopedRequest,
      usable,
      store,
      authorityVerified,
      recoveryReady,
    ],
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
      previousTransport.current.preview !== preview ||
      previousTransport.current.expectedAccountId !== expectedAccountId
    ) {
      previousTransport.current = { request, preview, expectedAccountId };
      clearPrivate(true);
      setError("");
    }
  }, [clearPrivate, request, preview, expectedAccountId]);
  useEffect(() => {
    if (!active || !authorityVerified || restored.current) return;
    restored.current = true;
    try {
      const saved = store?.readPending();
      if (saved) {
        pendingRef.current = saved.intent;
        pendingInbox.current = saved.inbox;
        setPending(saved.intent);
        setInbox(saved.inbox);
        view.current = { inbox: saved.inbox, page: 1 };
      } else {
        const last = store?.readSelection();
        if (last && !initialTarget) {
          setInbox(last.inbox);
          view.current = { inbox: last.inbox, page: 1 };
          selection.current = last.threadId;
          setSelected(last.threadId);
          void loadConversation(last.threadId);
        }
      }
      setRecoveryReady(true);
    } catch {
      setStorageWarning(
        "Nacrt se ne može sačuvati na uređaju. Oslobodi prostor pa osvježi stranicu.",
      );
    }
  }, [active, authorityVerified, store, initialTarget, loadConversation]);
  useEffect(() => {
    if (!store) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === store.logoutKey) {
        clearPrivate(true);
        setRequiresLogin(true);
        setError("Prijavi se ponovo.");
        return;
      }
      if (
        !event.key?.startsWith(`${store.prefix}draft.`) ||
        !authorityVerified ||
        !restored.current ||
        writing.current ||
        pendingRef.current
      )
        return;
      for (const key of draftCache.current.keys()) {
        if (unpersistedDrafts.current.has(key)) continue;
        const [selectedInbox, id] = key.split(":");
        if ((selectedInbox !== "personal" && selectedInbox !== "business") || !id) continue;
        try {
          const value = store.readDraftState(id, selectedInbox);
          draftCache.current.set(key, value.text);
          draftRevisions.current.set(key, value.key);
          if (selection.current === id) setDraft(value.text);
        } catch {
          /* Never replace a local draft when storage is unavailable. */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearPrivate, store, authorityVerified]);
  useEffect(() => {
    if (active) void loadList(inbox, page);
    return () => {
      for (const controller of controllers.current) controller.abort();
    };
  }, [active, inbox, loadList, page]);
  const targetKey = initialTarget ? `${initialTarget.kind}:${initialTarget.targetId}` : "";
  useEffect(() => {
    if (!targetKey) {
      handledTarget.current = "";
      return;
    }
    if (
      !active ||
      !initialTarget ||
      !usable ||
      (store && !recoveryReady) ||
      pending ||
      busy ||
      handledTarget.current === targetKey
    )
      return;
    handledTarget.current = targetKey;
    if (
      selection.current === conversation?.thread.id &&
      conversation?.thread.kind === initialTarget.kind &&
      conversation.thread.targetId === initialTarget.targetId
    )
      return;
    void commit({
      action: "open",
      path: "threads",
      body: { ...initialTarget },
      target: { ...initialTarget },
      key: crypto.randomUUID(),
      threadId: null,
    });
  }, [
    active,
    busy,
    commit,
    conversation,
    initialTarget,
    pending,
    targetKey,
    usable,
    store,
    recoveryReady,
  ]);
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
    if (busy || pending || selection.current === thread.id) return;
    selection.current = thread.id;
    setSelected(thread.id);
    setDraft(draftCache.current.get(`${thread.inbox}:${thread.id}`) ?? "");
    try {
      store?.saveSelection(thread.id, thread.inbox);
    } catch {
      setStorageWarning("Nacrt se trenutno čuva samo dok je aplikacija otvorena.");
    }
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
      let commandKey = crypto.randomUUID(),
        draftRevision: string | undefined;
      if (store) {
        const id = conversation.thread.id,
          selectedInbox = conversation.thread.inbox;
        const key = `${selectedInbox}:${id}`;
        if (unpersistedDrafts.current.has(key)) {
          draftRevisions.current.set(key, store.saveDraft(id, selectedInbox, draft));
          unpersistedDrafts.current.delete(key);
          setStorageWarning("");
        } else {
          // A different window may have sent this draft before its storage event arrived.
          const current = store.readDraftState(id, selectedInbox);
          if (current.text !== draft || current.key !== draftRevisions.current.get(key)) {
            draftCache.current.set(key, current.text);
            draftRevisions.current.set(key, current.key);
            setDraft(current.text);
            return;
          }
        }
        const revision = draftRevisions.current.get(key);
        if (!revision) throw new MessagingStorageError();
        // Two windows sending the same immutable draft version share one server command.
        commandKey = revision;
        draftRevision = revision;
      }
      const body = normalizeMessageBody(draft);
      void commit({
        action: "send",
        path: `threads/${conversation.thread.id}/messages`,
        body: { body },
        threadId: conversation.thread.id,
        key: commandKey,
        ...(draftRevision ? { draftRevision } : {}),
      });
    } catch (failure) {
      if (failure instanceof MessagingStorageError) fail(failure);
      else setError("Napiši poruku do 2.000 znakova.");
    }
  }
  const thread = conversation?.thread;
  return (
    <section className={styles.workspace} aria-label="Poruke" data-design="messages-panel">
      {heading && (
        <header className={styles.heading}>
          <div>
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
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          {requiresLogin && !preview && (
            <Link
              href="/prijava?nastavi=%2Fnalog%3Fodjeljak%3Dporuke"
              target={pending ? "_blank" : undefined}
              rel={pending ? "noopener" : undefined}
              aria-label={pending ? "Prijavi se u novoj kartici" : undefined}
            >
              Prijavi se
            </Link>
          )}
        </div>
      )}
      {storageWarning && (
        <p role="status" className={styles.error}>
          {storageWarning}
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
              {thread && !preview && (
                <Link href={reportUrl("conversation", thread.id)} className={styles.report}>
                  Prijavi razgovor
                </Link>
              )}
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
                data-design="message-composer"
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
                  onChange={(event) => {
                    const value = event.target.value;
                    if (selected) {
                      const selectedInbox = conversation?.thread.inbox ?? inbox;
                      draftCache.current.set(`${selectedInbox}:${selected}`, value);
                      try {
                        const revision = store?.saveDraft(selected, selectedInbox, value);
                        draftRevisions.current.set(
                          `${selectedInbox}:${selected}`,
                          revision ?? null,
                        );
                        store?.saveSelection(selected, selectedInbox);
                        unpersistedDrafts.current.delete(`${selectedInbox}:${selected}`);
                        setStorageWarning("");
                      } catch {
                        unpersistedDrafts.current.add(`${selectedInbox}:${selected}`);
                        setStorageWarning(
                          "Nacrt se trenutno čuva samo dok je aplikacija otvorena.",
                        );
                      }
                    }
                    setDraft(value);
                  }}
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
