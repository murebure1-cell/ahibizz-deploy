import {
  type ChatMessage,
  type ChatThread,
  type MessageInbox,
  type MessageTarget,
  normalizeMessageBody,
} from "../../lib/messaging";
import { MessagingRequestError, type messagingRequest } from "../../lib/messaging-client";

type Person = { id: string; name: string };
type Business = { id: string; title: string; ownerId: string; published: boolean };
type StoredThread = {
  id: string;
  kind: "person" | "business";
  participants: [string, string];
  names: Map<string, string>;
  businessId: string | null;
  businessTitle: string | null;
  ownerId: string | null;
  customerId: string | null;
  messages: (Omit<ChatMessage, "from"> & { senderId: string })[];
  reads: Map<string, number>;
  blocks: Set<string>;
};
type Options = {
  self: () => Person;
  person: (id: string) => Person | null;
  business: (id: string) => Business | null;
  now?: () => Date;
};
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function fail(status: number, code: string): never {
  throw new MessagingRequestError(status, code);
}
function text(value: unknown): string {
  try {
    return normalizeMessageBody(value);
  } catch {
    return fail(400, "INVALID_MESSAGE_BODY");
  }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail(400, "INVALID_MESSAGING_INPUT");
  return value as Record<string, unknown>;
}

/** Isolated, empty, browser-memory transport. It never calls fetch or a real messaging service. */
export function createMessagingPreviewApi(options: Options) {
  const threads = new Map<string, StoredThread>();
  const receipts = new Map<string, { intent: string; value: Record<string, unknown> }>();
  const listeners = new Set<() => void>();
  const rates = new Map<string, number[]>();
  let revision = 0;
  let actorId: string | null = null;
  let disposed = false;
  const now = () => (options.now?.() ?? new Date()).getTime();
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const self = () => {
    if (disposed) fail(503, "MESSAGING_UNAVAILABLE");
    const person = options.self();
    if (!person || !identifier.test(person.id) || !person.name) {
      threads.clear();
      receipts.clear();
      rates.clear();
      actorId = null;
      changed();
      fail(401, "AUTHENTICATION_REQUIRED");
    }
    if (actorId !== null && actorId !== person.id) {
      threads.clear();
      receipts.clear();
      rates.clear();
      changed();
    }
    actorId = person.id;
    return person;
  };
  const checkRate = (action: "open" | "send" | "block" | "command", id: string) => {
    const key = `${id}:${action}`,
      current = now();
    const timestamps = (rates.get(key) ?? []).filter(
      (time) => time > current - (action === "open" ? 3600000 : 60000),
    );
    if (
      timestamps.length >=
      (action === "open" ? 20 : action === "block" ? 30 : action === "command" ? 240 : 60)
    )
      fail(429, "MESSAGING_RATE_LIMIT");
    timestamps.push(current);
    rates.set(key, timestamps);
  };
  const currentThread = (id: string, actor: Person): StoredThread => {
    const thread = threads.get(id);
    if (!thread?.participants.includes(actor.id)) fail(404, "THREAD_NOT_FOUND");
    if (thread.businessId) {
      const business = options.business(thread.businessId);
      if (business && business.ownerId !== thread.ownerId) fail(404, "THREAD_NOT_FOUND");
    }
    return thread;
  };
  const projection = (thread: StoredThread, actor: Person): ChatThread => {
    const peerId = thread.participants.find((id) => id !== actor.id) as string;
    const business = thread.businessId ? options.business(thread.businessId) : null;
    const last = thread.messages.at(-1);
    const readSequence = thread.reads.get(actor.id) ?? 0;
    return {
      id: thread.id,
      kind: thread.kind,
      inbox: thread.kind === "business" && thread.ownerId === actor.id ? "business" : "personal",
      title:
        thread.kind === "business"
          ? `${business?.title ?? thread.businessTitle ?? "Djelatnost"}${thread.ownerId === actor.id ? ` · ${options.person(peerId)?.name ?? thread.names.get(peerId) ?? "Sagovornik"}` : ""}`
          : (options.person(peerId)?.name ?? thread.names.get(peerId) ?? "Sagovornik"),
      targetId: thread.kind === "business" ? (thread.businessId as string) : peerId,
      canSend: thread.blocks.size === 0 && (!thread.businessId || Boolean(business?.published)),
      blockedByMe: thread.blocks.has(actor.id),
      blocked: thread.blocks.size > 0,
      latestSequence: last?.sequence ?? 0,
      readSequence,
      unreadCount: thread.messages.filter(
        (message) => message.senderId !== actor.id && message.sequence > readSequence,
      ).length,
      lastMessage: last
        ? {
            body:
              [...last.body]
                .join("")
                .slice(0, 199)
                .replace(/[\uD800-\uDBFF]$/, "") + (last.body.length > 199 ? "…" : ""),
            createdAt: last.createdAt,
          }
        : null,
    };
  };
  const makeThread = (actor: Person, peer: Person, business: Business | null) => {
    const thread: StoredThread = {
      id: crypto.randomUUID(),
      kind: business ? "business" : "person",
      participants: [actor.id, peer.id],
      names: new Map([
        [actor.id, actor.name],
        [peer.id, peer.name],
      ]),
      businessId: business?.id ?? null,
      businessTitle: business?.title ?? null,
      ownerId: business?.ownerId ?? null,
      customerId: business ? (business.ownerId === actor.id ? peer.id : actor.id) : null,
      messages: [],
      reads: new Map(),
      blocks: new Set(),
    };
    threads.set(thread.id, thread);
    return thread;
  };
  const append = (thread: StoredThread, senderId: string, body: string) => {
    const message = {
      id: crypto.randomUUID(),
      sequence: (thread.messages.at(-1)?.sequence ?? 0) + 1,
      body,
      createdAt: new Date(now()).toISOString(),
      senderId,
    };
    thread.messages.push(message);
    changed();
    return { threadId: thread.id, messageId: message.id, sequence: message.sequence };
  };
  const open = (actor: Person, target: MessageTarget) => {
    if (target.kind === "person") {
      if (target.targetId === actor.id) fail(400, "SELF_MESSAGE_NOT_ALLOWED");
      const existing = [...threads.values()].find(
        (thread) =>
          thread.kind === "person" &&
          thread.participants.includes(actor.id) &&
          thread.participants.includes(target.targetId),
      );
      if (existing) return existing;
      const peer = options.person(target.targetId);
      if (!peer) fail(404, "PERSON_NOT_FOUND");
      checkRate("open", actor.id);
      return makeThread(actor, peer, null);
    }
    const business = options.business(target.targetId);
    if (!business?.published) fail(404, "BUSINESS_NOT_FOUND");
    if (business.ownerId === actor.id) fail(400, "SELF_MESSAGE_NOT_ALLOWED");
    const existing = [...threads.values()].find(
      (thread) =>
        thread.businessId === business.id &&
        thread.ownerId === business.ownerId &&
        thread.customerId === actor.id,
    );
    if (existing) return existing;
    const owner = options.person(business.ownerId);
    if (!owner) fail(404, "BUSINESS_NOT_FOUND");
    checkRate("open", actor.id);
    return makeThread(actor, owner, business);
  };

  const request: typeof messagingRequest = async (path, init = {}) => {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const actor = self();
    if (
      !/^threads(?:\?|\/|$)/.test(path) ||
      path.includes("..") ||
      path.includes("#") ||
      path.includes("%") ||
      path.includes("\\")
    )
      fail(400, "INVALID_MESSAGING_INPUT");
    const url = new URL(path, "https://messaging-fixture.invalid/");
    const route = url.pathname.slice(1),
      method = (init.method ?? "GET").toUpperCase();
    const detail = /^threads\/([a-f0-9-]{36})(?:\/(messages|read|block))?$/.exec(route);
    if (route !== "threads" && !detail) fail(404, "THREAD_NOT_FOUND");
    const allowed =
      method === "GET"
        ? route === "threads"
          ? ["inbox", "page"]
          : !detail?.[2]
            ? ["before"]
            : []
        : [];
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (!allowed.includes(key) || seen.has(key)) fail(400, "INVALID_MESSAGING_INPUT");
      seen.add(key);
      if (key === "inbox" && !["personal", "business"].includes(value))
        fail(400, "INVALID_MESSAGING_INPUT");
      if (
        key !== "inbox" &&
        (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > (key === "page" ? 1000 : 2147483647))
      )
        fail(400, "INVALID_MESSAGING_INPUT");
    }
    if (method === "GET") {
      if (route === "threads") {
        const inbox = (url.searchParams.get("inbox") ?? "personal") as MessageInbox;
        const page = Number(url.searchParams.get("page") ?? 1);
        const items = [...threads.values()]
          .filter((thread) => {
            if (!thread.participants.includes(actor.id)) return false;
            if (thread.businessId) {
              const business = options.business(thread.businessId);
              if (business && business.ownerId !== thread.ownerId) return false;
            }
            return projection(thread, actor).inbox === inbox;
          })
          .sort(
            (a, b) =>
              (b.messages.at(-1)?.createdAt ?? "").localeCompare(
                a.messages.at(-1)?.createdAt ?? "",
              ) || a.id.localeCompare(b.id),
          )
          .map((thread) => projection(thread, actor));
        return structuredClone({
          items: items.slice((page - 1) * 30, page * 30),
          page,
          hasMore: items.length > page * 30,
        });
      }
      if (!detail || detail[2]) fail(404, "THREAD_NOT_FOUND");
      const thread = currentThread(detail[1] as string, actor);
      const before = Number(url.searchParams.get("before") ?? 2147483648);
      const all = thread.messages.filter((message) => message.sequence < before);
      const items = all.slice(-50).map(({ senderId, ...message }) => ({
        ...message,
        from: senderId === actor.id ? "me" : "peer",
      }));
      return structuredClone({
        thread: projection(thread, actor),
        items,
        hasMore: all.length > 50,
      });
    }
    if (method !== "POST") fail(405, "METHOD_NOT_ALLOWED");
    let input: unknown;
    try {
      input = JSON.parse(String(init.body));
    } catch {
      fail(400, "INVALID_MESSAGING_INPUT");
    }
    if (detail?.[2] === "read") {
      const value = object(input, ["throughSequence"]),
        thread = currentThread(detail[1] as string, actor);
      if (
        !Number.isInteger(value.throughSequence) ||
        (value.throughSequence as number) < 0 ||
        (value.throughSequence as number) > (thread.messages.at(-1)?.sequence ?? 0)
      )
        fail(400, "INVALID_MESSAGING_INPUT");
      const prior = thread.reads.get(actor.id) ?? 0,
        next = Math.max(prior, value.throughSequence as number);
      if (next !== prior) {
        thread.reads.set(actor.id, next);
        changed();
      }
      return { readSequence: next };
    }
    const key = new Headers(init.headers).get("idempotency-key");
    if (!key || !uuid.test(key)) fail(400, "IDEMPOTENCY_KEY_REQUIRED");
    let value: Record<string, unknown>;
    if (route === "threads") {
      value = object(input, ["kind", "targetId"]);
      if (
        !["person", "business"].includes(String(value.kind)) ||
        typeof value.targetId !== "string" ||
        !identifier.test(value.targetId)
      )
        fail(400, "INVALID_MESSAGING_INPUT");
    } else if (detail?.[2] === "messages") {
      value = { body: text(object(input, ["body"]).body) };
    } else if (detail?.[2] === "block") {
      value = object(input, ["blocked"]);
      if (typeof value.blocked !== "boolean") fail(400, "INVALID_MESSAGING_INPUT");
    } else fail(404, "THREAD_NOT_FOUND");
    const intent = JSON.stringify([route, value]);
    if (detail) currentThread(detail[1] as string, actor);
    const receiptId = `${actor.id}:${key.toLowerCase()}`,
      previous = receipts.get(receiptId);
    if (previous) {
      if (previous.intent !== intent) fail(409, "IDEMPOTENCY_CONFLICT");
      return structuredClone(previous.value);
    }
    let result: Record<string, unknown>;
    const priorRates = structuredClone(rates);
    try {
      checkRate("command", actor.id);
      if (route === "threads") {
        const thread = open(actor, value as MessageTarget);
        result = { receipt: { threadId: thread.id, messageId: null, sequence: null } };
        changed();
      } else {
        const thread = currentThread(detail?.[1] as string, actor);
        if (detail?.[2] === "block") {
          checkRate("block", actor.id);
          if (value.blocked) thread.blocks.add(actor.id);
          else thread.blocks.delete(actor.id);
          changed();
          result = { receipt: { threadId: thread.id, messageId: null, sequence: null } };
        } else {
          if (!projection(thread, actor).canSend)
            fail(409, thread.blocks.size ? "MESSAGING_BLOCKED" : "CONVERSATION_UNAVAILABLE");
          checkRate("send", actor.id);
          result = { receipt: append(thread, actor.id, value.body as string) };
        }
      }
    } catch (error) {
      rates.clear();
      for (const [rateKey, timestamps] of priorRates) rates.set(rateKey, timestamps);
      throw error;
    }
    receipts.set(receiptId, { intent, value: structuredClone(result) });
    return structuredClone(result);
  };
  return {
    request,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshotVersion: () => revision,
    simulatePeerReply(threadId: string, body: string) {
      const actor = self(),
        thread = currentThread(threadId, actor);
      if (!projection(thread, actor).canSend)
        fail(409, thread.blocks.size ? "MESSAGING_BLOCKED" : "CONVERSATION_UNAVAILABLE");
      const peer = thread.participants.find((id) => id !== actor.id) as string;
      if (!options.person(peer)) fail(404, "PERSON_NOT_FOUND");
      return append(thread, peer, text(body));
    },
    seedBusinessInquiry(businessId: string, customerId: string, body: string) {
      const actor = self(),
        business = options.business(businessId),
        customer = options.person(customerId);
      if (
        !business?.published ||
        business.ownerId !== actor.id ||
        !customer ||
        customer.id === actor.id
      )
        fail(400, "INVALID_MESSAGING_INPUT");
      const existing = [...threads.values()].find(
        (thread) =>
          thread.businessId === businessId &&
          thread.ownerId === actor.id &&
          thread.customerId === customerId,
      );
      if (existing) return existing.id;
      const content = text(body);
      const thread = makeThread(actor, customer, business);
      append(thread, customer.id, content);
      return thread.id;
    },
    dispose() {
      disposed = true;
      threads.clear();
      receipts.clear();
      rates.clear();
      listeners.clear();
      revision++;
    },
  };
}
