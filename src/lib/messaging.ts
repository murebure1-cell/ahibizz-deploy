export type MessageKind = "person" | "business";
export type MessageInbox = "personal" | "business";
export type MessageTarget = { kind: MessageKind; targetId: string };
export type ChatMessage = {
  id: string;
  sequence: number;
  body: string;
  createdAt: string;
  from: "me" | "peer";
};
export type ChatThread = {
  id: string;
  kind: MessageKind;
  inbox: MessageInbox;
  title: string;
  targetId: string;
  canSend: boolean;
  blockedByMe: boolean;
  blocked: boolean;
  latestSequence: number;
  readSequence: number;
  unreadCount: number;
  lastMessage: { body: string; createdAt: string } | null;
};
export type ChatThreadPage = { items: ChatThread[]; page: number; hasMore: boolean };
export type ChatConversation = { thread: ChatThread; items: ChatMessage[]; hasMore: boolean };
export type ChatReceipt = { threadId: string; messageId: string | null; sequence: number | null };

const maxSequence = 2147483647;
export function messageIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_chat");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0, max = maxSequence): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}
function plain(value: unknown, max: number, multiline: boolean): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return false;
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (
      (code < 32 && !(multiline && [9, 10].includes(code))) ||
      (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      return false;
  }
  return true;
}
function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"))
  );
}
/** Canonical text is shared by browser fixtures and the server validation boundary. */
export function normalizeMessageBody(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_message_body");
  const body = value.replaceAll("\r\n", "\n").trim();
  if (!plain(body, 2000, true) || new TextEncoder().encode(body).byteLength > 8000)
    throw new Error("invalid_message_body");
  return body;
}
function target(value: unknown): MessageTarget {
  const row = object(value);
  if ((row.kind !== "person" && row.kind !== "business") || !messageIdentifier(row.targetId))
    throw new Error("invalid_message_target");
  return { kind: row.kind, targetId: row.targetId };
}
export function messageLink(value: MessageTarget, preview = false): string {
  const selected = target(value),
    key = selected.kind === "person" ? "osoba" : "djelatnost";
  return `${preview ? "/pregled/prostor/poruke?" : "/nalog?odjeljak=poruke&"}${key}=${encodeURIComponent(selected.targetId)}`;
}
/** Closed deep-link target; arbitrary return URLs, duplicates and mixed targets are rejected. */
export function readMessageTarget(params: URLSearchParams): MessageTarget | null {
  if (!(params instanceof URLSearchParams)) throw new Error("invalid_message_target");
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (
      !["odjeljak", "osoba", "djelatnost"].includes(key) ||
      seen.has(key) ||
      (key === "odjeljak" && value !== "poruke")
    )
      throw new Error("invalid_message_target");
    seen.add(key);
  }
  if (seen.has("osoba") && seen.has("djelatnost")) throw new Error("invalid_message_target");
  if (!seen.has("osoba") && !seen.has("djelatnost")) return null;
  return target({
    kind: seen.has("osoba") ? "person" : "business",
    targetId: params.get(seen.has("osoba") ? "osoba" : "djelatnost"),
  });
}
export function readChatThread(value: unknown): ChatThread {
  const row = object(value),
    selected = target(row);
  if (
    !messageIdentifier(row.id) ||
    !plain(row.title, 256, false) ||
    (row.inbox !== "personal" && row.inbox !== "business") ||
    (selected.kind === "person" && row.inbox !== "personal") ||
    typeof row.canSend !== "boolean" ||
    typeof row.blockedByMe !== "boolean" ||
    typeof row.blocked !== "boolean" ||
    !integer(row.latestSequence) ||
    !integer(row.readSequence) ||
    !integer(row.unreadCount) ||
    row.readSequence > row.latestSequence ||
    row.unreadCount > row.latestSequence - row.readSequence ||
    (row.blockedByMe && !row.blocked) ||
    (row.blocked && row.canSend)
  )
    throw new Error("invalid_chat_thread");
  let lastMessage: ChatThread["lastMessage"] = null;
  if (row.lastMessage !== null) {
    const last = object(row.lastMessage);
    if (!plain(last.body, 200, true) || !timestamp(last.createdAt) || row.latestSequence === 0)
      throw new Error("invalid_chat_thread");
    lastMessage = { body: last.body, createdAt: last.createdAt };
  } else if (row.latestSequence !== 0) throw new Error("invalid_chat_thread");
  return {
    id: row.id,
    ...selected,
    inbox: row.inbox,
    title: row.title,
    canSend: row.canSend,
    blockedByMe: row.blockedByMe,
    blocked: row.blocked,
    latestSequence: row.latestSequence,
    readSequence: row.readSequence,
    unreadCount: row.unreadCount,
    lastMessage,
  };
}
export function readChatThreadPage(value: unknown): ChatThreadPage {
  const row = object(value);
  if (
    !Array.isArray(row.items) ||
    row.items.length > 30 ||
    !integer(row.page, 1, 1000) ||
    typeof row.hasMore !== "boolean"
  )
    throw new Error("invalid_chat_page");
  const items = row.items.map(readChatThread);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error("invalid_chat_page");
  return { items, page: row.page, hasMore: row.hasMore };
}
export function readChatConversation(value: unknown): ChatConversation {
  const row = object(value),
    thread = readChatThread(row.thread);
  if (!Array.isArray(row.items) || row.items.length > 50 || typeof row.hasMore !== "boolean")
    throw new Error("invalid_chat_conversation");
  let prior = 0;
  const items: ChatMessage[] = row.items.map((value) => {
    const item = object(value);
    if (
      !messageIdentifier(item.id) ||
      !integer(item.sequence, 1) ||
      item.sequence <= prior ||
      (prior > 0 && item.sequence !== prior + 1) ||
      item.sequence > thread.latestSequence ||
      !timestamp(item.createdAt) ||
      (item.from !== "me" && item.from !== "peer") ||
      typeof item.body !== "string" ||
      normalizeMessageBody(item.body) !== item.body
    )
      throw new Error("invalid_chat_message");
    prior = item.sequence;
    return {
      id: item.id,
      sequence: item.sequence,
      body: item.body,
      createdAt: item.createdAt,
      from: item.from,
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error("invalid_chat_message");
  return { thread, items, hasMore: row.hasMore };
}
/** Never acknowledge new messages from an older-page response's newer thread metadata. */
export function conversationReadThrough(
  conversation: ChatConversation,
  before?: number,
): number | null {
  if (before !== undefined) return null;
  const through = conversation.items.at(-1)?.sequence ?? 0;
  if (!integer(through) || through !== conversation.thread.latestSequence)
    throw new Error("invalid_chat_conversation");
  return through;
}
export function readChatReceipt(value: unknown): ChatReceipt {
  const row = object(value);
  if (
    !messageIdentifier(row.threadId) ||
    !(
      (row.messageId === null && row.sequence === null) ||
      (messageIdentifier(row.messageId) && integer(row.sequence, 1))
    )
  )
    throw new Error("invalid_chat_receipt");
  return {
    threadId: row.threadId,
    messageId: row.messageId as string | null,
    sequence: row.sequence as number | null,
  };
}
