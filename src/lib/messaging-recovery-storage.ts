import {
  type ChatReceipt,
  type MessageInbox,
  type MessageTarget,
  messageIdentifier,
  normalizeMessageBody,
  readChatReceipt,
} from "./messaging";

export type MessagingIntent = {
  action: "open" | "send" | "block";
  path: string;
  body: Record<string, unknown>;
  key: string;
  threadId: string | null;
  target?: MessageTarget;
  receipt?: ChatReceipt;
  uncertain?: boolean;
  draftRevision?: string;
};
type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type StoredCommand = { intent: MessagingIntent; inbox: MessageInbox };
const retention = 30 * 24 * 60 * 60 * 1000;
const maxDrafts = 100;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_journal");
  return value as Record<string, unknown>;
}
function inbox(value: unknown): value is MessageInbox {
  return value === "personal" || value === "business";
}
function readIntent(value: unknown): MessagingIntent {
  const row = object(value),
    body = object(row.body);
  if (typeof row.key !== "string" || !uuid.test(row.key)) throw Error("invalid_journal");
  let intent: MessagingIntent;
  if (row.action === "open") {
    if (
      row.path !== "threads" ||
      row.threadId !== null ||
      (body.kind !== "person" && body.kind !== "business") ||
      !messageIdentifier(body.targetId)
    )
      throw Error("invalid_journal");
    const target = { kind: body.kind, targetId: body.targetId } as MessageTarget;
    intent = {
      action: "open",
      path: "threads",
      body: { ...target },
      target,
      key: row.key,
      threadId: null,
    };
  } else {
    if (!messageIdentifier(row.threadId)) throw Error("invalid_journal");
    if (row.action === "send") {
      const text = normalizeMessageBody(body.body);
      if (text !== body.body || row.path !== `threads/${row.threadId}/messages`)
        throw Error("invalid_journal");
      intent = {
        action: "send",
        path: row.path,
        body: { body: text },
        key: row.key,
        threadId: row.threadId,
      };
    } else if (
      row.action === "block" &&
      typeof body.blocked === "boolean" &&
      row.path === `threads/${row.threadId}/block`
    ) {
      intent = {
        action: "block",
        path: row.path,
        body: { blocked: body.blocked },
        key: row.key,
        threadId: row.threadId,
      };
    } else throw Error("invalid_journal");
  }
  if (row.receipt !== undefined) {
    const receipt = readChatReceipt(row.receipt);
    if (
      (intent.threadId && receipt.threadId !== intent.threadId) ||
      (intent.action === "send" ? receipt.messageId === null : receipt.messageId !== null)
    )
      throw Error("invalid_journal");
    intent.receipt = receipt;
  }
  if (row.draftRevision !== undefined) {
    if (intent.action !== "send" || row.draftRevision !== intent.key)
      throw Error("invalid_journal");
    intent.draftRevision = intent.key;
  }
  return { ...intent, uncertain: true };
}

export class MessagingStorageError extends Error {
  constructor() {
    super("Messaging recovery storage is unavailable.");
  }
}

/** Device-local drafts only. Call reads only after current actor-bound server authority succeeds. */
export class MessagingRecoveryStore {
  readonly prefix: string;
  readonly logoutKey: string;
  private revisionTime = 0;
  private cleanupKeys: string[] = [];
  private cleanupIndex = 0;
  private lastCleanup: number | null = null;
  constructor(
    private readonly storage: () => StorageLike,
    accountId: string,
    namespace = "live",
    private readonly now: () => number = Date.now,
  ) {
    if (!messageIdentifier(accountId) || !/^[A-Za-z0-9_-]{1,80}$/.test(namespace))
      throw Error("invalid_journal_scope");
    this.prefix = `ahibizz.messaging.v1.${namespace}.${accountId}.`;
    this.logoutKey = `${this.prefix}logout`;
  }
  private read(key: string): unknown {
    try {
      const raw = this.storage().getItem(this.prefix + key);
      if (raw === null) return null;
      if (raw.length > 24000) {
        this.storage().removeItem(this.prefix + key);
        return null;
      }
      let value: Record<string, unknown>;
      try {
        value = object(JSON.parse(raw));
      } catch {
        this.storage().removeItem(this.prefix + key);
        return null;
      }
      if (
        value.v !== 1 ||
        typeof value.at !== "number" ||
        !Number.isSafeInteger(value.at) ||
        value.at > this.now() + 60000 ||
        this.now() - value.at > retention
      ) {
        this.storage().removeItem(this.prefix + key);
        return null;
      }
      return value.value;
    } catch {
      throw new MessagingStorageError();
    }
  }
  private write(key: string, value: unknown) {
    try {
      const raw = JSON.stringify({ v: 1, at: this.now(), value });
      if (raw.length > 24000) throw new MessagingStorageError();
      this.storage().setItem(this.prefix + key, raw);
      if (this.storage().getItem(this.prefix + key) !== raw) throw new MessagingStorageError();
    } catch {
      throw new MessagingStorageError();
    }
  }
  private remove(key: string) {
    try {
      this.storage().removeItem(this.prefix + key);
    } catch {
      throw new MessagingStorageError();
    }
  }
  private keys(prefix: string): string[] {
    try {
      const storage = this.storage(),
        keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(this.prefix + prefix)) keys.push(key.slice(this.prefix.length));
      }
      return keys;
    } catch {
      throw new MessagingStorageError();
    }
  }
  private cleanupReceipts() {
    const now = this.now();
    if (this.lastCleanup !== null && now >= this.lastCleanup && now - this.lastCleanup < 60000)
      return;
    this.lastCleanup = now;
    if (this.cleanupIndex >= this.cleanupKeys.length) {
      this.cleanupKeys = [...this.keys("done."), ...this.keys("receipt.")];
      this.cleanupIndex = 0;
    }
    // Bound synchronous work; continued authorized reads resume the next batch.
    const end = Math.min(this.cleanupIndex + 64, this.cleanupKeys.length);
    while (this.cleanupIndex < end) {
      const key = this.cleanupKeys[this.cleanupIndex++];
      if (!key) continue;
      const value = this.read(key);
      if (value === null) continue;
      try {
        readChatReceipt(value);
      } catch {
        this.remove(key);
      }
    }
  }
  private draftEntries(threadId: string, selectedInbox: MessageInbox) {
    const prefix = `draft.${selectedInbox}.${threadId}.`;
    const entries: { key: string; text: string; time: number }[] = [];
    for (const key of this.keys(prefix)) {
      const value = this.read(key);
      if (value === null) continue;
      try {
        const row = object(value);
        if (
          typeof row.text !== "string" ||
          row.text.length > 2000 ||
          new TextEncoder().encode(row.text).byteLength > 8000 ||
          typeof row.time !== "number" ||
          !Number.isSafeInteger(row.time) ||
          row.time > this.now() + 60000
        )
          throw Error("invalid_journal");
        entries.push({ key, text: row.text, time: row.time });
      } catch (failure) {
        if (failure instanceof MessagingStorageError) throw failure;
        this.remove(key);
      }
    }
    return entries.sort((a, b) => b.time - a.time || b.key.localeCompare(a.key));
  }
  readDraft(threadId: string, selectedInbox: MessageInbox): string {
    return this.readDraftState(threadId, selectedInbox).text;
  }
  readDraftState(
    threadId: string,
    selectedInbox: MessageInbox,
  ): { text: string; key: string | null } {
    if (!messageIdentifier(threadId) || !inbox(selectedInbox)) return { text: "", key: null };
    const entry = this.draftEntries(threadId, selectedInbox)[0];
    if (!entry) return { text: "", key: null };
    const key = entry.key.slice(entry.key.lastIndexOf(".") + 1);
    if (!uuid.test(key)) return { text: "", key: null };
    return { text: entry.text, key };
  }
  saveDraft(threadId: string, selectedInbox: MessageInbox, text: string) {
    if (
      !messageIdentifier(threadId) ||
      !inbox(selectedInbox) ||
      typeof text !== "string" ||
      text.length > 2000 ||
      new TextEncoder().encode(text).byteLength > 8000
    )
      throw new MessagingStorageError();
    const previous = this.draftEntries(threadId, selectedInbox);
    if (!previous.length && text) {
      const threads = new Set<string>();
      for (const key of this.keys("draft.")) {
        const value = this.read(key);
        if (
          value &&
          typeof value === "object" &&
          typeof (value as { text?: unknown }).text === "string" &&
          (value as { text: string }).text
        )
          threads.add(key.split(".").slice(0, 3).join("."));
      }
      if (threads.size >= maxDrafts) throw new MessagingStorageError();
    }
    const time = Math.max(this.now(), this.revisionTime + 1);
    this.revisionTime = time;
    const key = `draft.${selectedInbox}.${threadId}.${crypto.randomUUID()}`;
    this.write(key, { text, time });
    // Remove only revisions observed before this write; concurrent new revisions survive.
    for (const entry of previous) this.remove(entry.key);
    return key.slice(key.lastIndexOf(".") + 1);
  }
  /** A confirmation must never remove a newer draft written in another tab. */
  clearSentDraft(
    threadId: string,
    selectedInbox: MessageInbox,
    sentBody: string,
    commandKey: string,
  ): string {
    if (!uuid.test(commandKey)) throw new MessagingStorageError();
    // A late response from another window must not recapture or clear a newer draft.
    const completed = this.read(`done.${commandKey}`);
    if (completed !== null) {
      try {
        const receipt = readChatReceipt(completed);
        if (receipt.threadId !== threadId || receipt.messageId === null)
          throw Error("invalid_journal");
        return this.readDraft(threadId, selectedInbox);
      } catch (failure) {
        if (failure instanceof MessagingStorageError) throw failure;
        this.remove(`done.${commandKey}`);
      }
    }
    const value = this.read(`pending.${commandKey}`);
    if (value) {
      const envelope = object(value),
        intent = readIntent(envelope.intent);
      if (
        intent.action !== "send" ||
        intent.threadId !== threadId ||
        intent.body.body !== sentBody ||
        envelope.inbox !== selectedInbox
      )
        throw new MessagingStorageError();
      const keys = Array.isArray(envelope.draftKeys) ? envelope.draftKeys : [];
      for (const key of keys) {
        if (typeof key !== "string" || !key.startsWith(`draft.${selectedInbox}.${threadId}.`))
          throw new MessagingStorageError();
        this.remove(key);
      }
    }
    return this.readDraft(threadId, selectedInbox);
  }
  readPending(): StoredCommand | null {
    this.cleanupReceipts();
    const keys = this.keys("pending.");
    // Independent command keys prevent two windows overwriting each other's unknown outcomes.
    for (const key of keys.sort()) {
      const value = this.read(key);
      if (value === null) continue;
      try {
        const row = object(value);
        if (!inbox(row.inbox)) throw Error("invalid_journal");
        const intent = readIntent(row.intent);
        if (key !== `pending.${intent.key}`) throw Error("invalid_journal");
        const savedReceipt = this.read(`receipt.${intent.key}`);
        if (savedReceipt !== null) {
          try {
            intent.receipt = readIntent({ ...intent, receipt: savedReceipt }).receipt;
          } catch {
            this.remove(`receipt.${intent.key}`);
          }
        }
        return { inbox: row.inbox, intent };
      } catch (failure) {
        if (failure instanceof MessagingStorageError) throw failure;
        this.remove(key);
      }
    }
    return null;
  }
  savePending(intent: MessagingIntent, selectedInbox: MessageInbox) {
    if (!inbox(selectedInbox)) throw new MessagingStorageError();
    const safe = readIntent(intent),
      key = `pending.${safe.key}`,
      value = this.read(key);
    const completed = this.read(`done.${safe.key}`);
    if (completed !== null) {
      try {
        return readIntent({ ...safe, receipt: completed });
      } catch {
        this.remove(`done.${safe.key}`);
      }
    }
    let draftKeys: string[] = [];
    if (value !== null) {
      const envelope = object(value),
        current = readIntent(envelope.intent);
      if (current.path !== safe.path || JSON.stringify(current.body) !== JSON.stringify(safe.body))
        throw new MessagingStorageError();
      // A stale window must not downgrade a receipt another window already received.
      if (current.receipt && !safe.receipt) safe.receipt = current.receipt;
      if (
        Array.isArray(envelope.draftKeys) &&
        envelope.draftKeys.every((key) => typeof key === "string")
      )
        draftKeys = envelope.draftKeys;
    } else if (safe.action === "send" && safe.threadId) {
      draftKeys = this.draftEntries(safe.threadId, selectedInbox)
        .filter((entry) => {
          if (safe.draftRevision && !entry.key.endsWith(`.${safe.draftRevision}`)) return false;
          try {
            return normalizeMessageBody(entry.text) === safe.body.body;
          } catch {
            return false;
          }
        })
        .map((entry) => entry.key);
    }
    this.write(key, { inbox: selectedInbox, intent: safe, draftKeys });
    if (safe.receipt) this.write(`receipt.${safe.key}`, safe.receipt);
    return safe;
  }
  completePending(key: string, receipt: ChatReceipt) {
    if (!uuid.test(key)) throw new MessagingStorageError();
    this.write(`done.${key}`, readChatReceipt(receipt));
    this.clearPending(key);
  }
  clearPending(key: string) {
    if (!uuid.test(key)) throw new MessagingStorageError();
    this.remove(`pending.${key}`);
    this.remove(`receipt.${key}`);
  }
  saveSelection(threadId: string, selectedInbox: MessageInbox) {
    if (!messageIdentifier(threadId) || !inbox(selectedInbox)) throw new MessagingStorageError();
    this.write("selection", { threadId, inbox: selectedInbox });
  }
  readSelection(): { threadId: string; inbox: MessageInbox } | null {
    const value = this.read("selection");
    if (!value) return null;
    try {
      const row = object(value);
      if (!messageIdentifier(row.threadId) || !inbox(row.inbox)) throw Error("invalid_journal");
      return { threadId: row.threadId, inbox: row.inbox };
    } catch {
      this.remove("selection");
      return null;
    }
  }
  clearSelection(threadId: string | null) {
    if (threadId && this.readSelection()?.threadId === threadId) this.remove("selection");
  }
  clear() {
    try {
      const storage = this.storage(),
        keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(this.prefix)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
      // Notify other open windows without retaining any message text.
      storage.setItem(this.logoutKey, String(this.now()));
    } catch {
      throw new MessagingStorageError();
    }
  }
}

export function browserMessagingRecoveryStore(accountId: string): MessagingRecoveryStore {
  return new MessagingRecoveryStore(() => window.localStorage, accountId);
}
export function clearBrowserMessagingRecovery(accountId: string) {
  try {
    browserMessagingRecoveryStore(accountId).clear();
  } catch {
    /* Never block sign-out. */
  }
}
