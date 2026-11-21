import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ChatConversation,
  ChatMessage,
  ChatReceipt,
  ChatThread,
  ChatThreadPage,
} from "../../lib/messaging";
import { contactBlocked, writePeopleBlock } from "../account-blocks";
import {
  AccountAccessError,
  type AccountService,
  type AuthService,
  type CurrentAuthUser,
  getAccountService,
  getAuthService,
} from "../auth";
import { getAuthDatabasePool } from "../auth/service";
import {
  blockInput,
  fail,
  listInput,
  MessagingAccessError,
  openInput,
  readInput,
  readMarkInput,
  sendInput,
  uuid,
} from "./validation";

type SignedSession = { id: string; userId: string; token: string; expectedAccountId?: string };
type ThreadRow = {
  id: string;
  kind: "person" | "business";
  left_user_id: string;
  right_user_id: string;
  business_id: string | null;
  latest_sequence: number;
};
type BusinessRow = { id: string; owner_user_id: string; status: string; title: string };
type Context = {
  actor: CurrentAuthUser;
  peer: CurrentAuthUser | undefined;
  thread: ThreadRow;
  business: BusinessRow | null;
};
function available(user: CurrentAuthUser | undefined): boolean {
  return Boolean(
    user &&
      user.approval === "approved" &&
      user.emailVerified &&
      (user.role === "member" || user.role === "owner"),
  );
}
function eligible(user: CurrentAuthUser | undefined): asserts user is CurrentAuthUser {
  if (!user) fail(401, "AUTHENTICATION_REQUIRED");
  if (user.approval === "suspended") fail(403, "ACCOUNT_SUSPENDED");
  if (user.approval !== "approved") fail(403, "ACCOUNT_PENDING_APPROVAL");
  if (!user.emailVerified) fail(403, "EMAIL_NOT_VERIFIED");
  if (user.role !== "member" && user.role !== "owner") fail(403, "ACCOUNT_ACCESS_DENIED");
}
async function safe<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof MessagingAccessError) throw error;
    if (error instanceof AccountAccessError)
      throw new MessagingAccessError(error.status, error.code);
    throw new MessagingAccessError(503, "MESSAGING_UNAVAILABLE");
  }
}
async function transaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  return safe(async () => {
    const client = await pool.connect();
    let begun = false,
      discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      begun = true;
      await client.query("SET LOCAL lock_timeout='1s'");
      await client.query("SET LOCAL statement_timeout='2s'");
      const result = await body(client);
      await client.query("COMMIT");
      begun = false;
      return result;
    } catch (error) {
      if (begun)
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      throw error;
    } finally {
      client.release(discard);
    }
  });
}
async function authority(client: PoolClient, signed: SignedSession, others: string[] = []) {
  const ids = [...new Set([signed.userId, ...others])].sort();
  const users = (
    await client.query<CurrentAuthUser>(
      'SELECT id,name,email,"emailVerified",role,approval FROM auth_user WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
      [ids],
    )
  ).rows;
  const actor = users.find((u) => u.id === signed.userId);
  eligible(actor);
  if (signed.expectedAccountId !== undefined && actor.id !== signed.expectedAccountId)
    fail(401, "ACCOUNT_IDENTITY_CHANGED");
  const session = await client.query(
    'WITH locked_session AS MATERIALIZED (SELECT id,"expiresAt" FROM auth_session WHERE id=$1 AND "userId"=$2 AND token=$3 FOR UPDATE) SELECT id FROM locked_session WHERE "expiresAt">clock_timestamp()',
    [signed.id, signed.userId, signed.token],
  );
  if (session.rowCount !== 1) fail(401, "AUTHENTICATION_REQUIRED");
  return { actor, users };
}
async function context(client: PoolClient, signed: SignedSession, id: string): Promise<Context> {
  const hint = (
    await client.query<ThreadRow>(
      "SELECT id,kind,left_user_id,right_user_id,business_id,latest_sequence FROM message_thread WHERE id=$1 AND $2 IN (left_user_id,right_user_id)",
      [id, signed.userId],
    )
  ).rows[0];
  if (!hint) fail(404, "THREAD_NOT_FOUND");
  const { actor, users } = await authority(client, signed, [hint.left_user_id, hint.right_user_id]);
  const business = hint.business_id
    ? ((
        await client.query<BusinessRow>(
          "SELECT id,owner_user_id, CASE WHEN package_allows_listing(b) THEN status ELSE 'draft' END AS status,title FROM directory_business b WHERE id=$1 FOR UPDATE",
          [hint.business_id],
        )
      ).rows[0] ?? null)
    : null;
  if (hint.kind === "business" && (!business || business.owner_user_id !== hint.right_user_id))
    fail(404, "THREAD_NOT_FOUND");
  const thread = (
    await client.query<ThreadRow>(
      "SELECT id,kind,left_user_id,right_user_id,business_id,latest_sequence FROM message_thread WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!thread || ![thread.left_user_id, thread.right_user_id].includes(actor.id))
    fail(404, "THREAD_NOT_FOUND");
  return { actor, peer: users.find((u) => u.id !== actor.id), thread, business };
}

// Only participants reach this projection. Names do not imply public profile visibility.
const columns = `t.id,t.kind,
 CASE WHEN t.kind='business' AND t.right_user_id=$1 THEN 'business' ELSE 'personal' END AS inbox,
 CASE WHEN t.kind='business' THEN CASE WHEN t.left_user_id=$1 THEN b.title ELSE b.title||' · '||left(peer.name,128) END ELSE peer.name END AS title,
 CASE WHEN t.kind='business' THEN t.business_id::text ELSE peer.id END AS "targetId",
 (peer.approval='approved' AND peer."emailVerified"=true AND peer.role IN ('member','owner')
   AND (t.kind='person' OR b.status='published' AND package_allows_listing(b))
   AND NOT (t.kind='business' AND (own.blocked OR theirs.blocked))
   AND NOT COALESCE(own_block.blocked,false) AND NOT COALESCE(peer_block.blocked,false)) AS "canSend",
 (CASE WHEN t.kind='person' THEN COALESCE(own_block.blocked,false) ELSE own.blocked END) AS "blockedByMe",
 ((t.kind='business' AND (own.blocked OR theirs.blocked)) OR COALESCE(own_block.blocked,false) OR COALESCE(peer_block.blocked,false)) AS blocked,
 t.latest_sequence AS "latestSequence",own.read_sequence AS "readSequence",
 (SELECT count(*)::integer FROM message_message unread WHERE unread.thread_id=t.id AND unread.sequence>own.read_sequence AND unread.sender_user_id<>$1) AS "unreadCount",
 (SELECT jsonb_build_object('body',left(last.body,200),'createdAt',to_char(last.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM message_message last WHERE last.thread_id=t.id ORDER BY last.sequence DESC LIMIT 1) AS "lastMessage"`;
const joins = `JOIN auth_user peer ON peer.id=CASE WHEN t.left_user_id=$1 THEN t.right_user_id ELSE t.left_user_id END
 JOIN message_thread_member own ON own.thread_id=t.id AND own.user_id=$1
 JOIN message_thread_member theirs ON theirs.thread_id=t.id AND theirs.user_id=peer.id
 LEFT JOIN people_block own_block ON own_block.actor_id=$1 AND own_block.target_id=peer.id
 LEFT JOIN people_block peer_block ON peer_block.actor_id=peer.id AND peer_block.target_id=$1
 LEFT JOIN directory_business b ON b.id=t.business_id`;
const visible = `$1 IN (t.left_user_id,t.right_user_id) AND (t.kind='person' OR b.owner_user_id=t.right_user_id)`;
function bounded(value: string, maximum: number): string {
  let output = "";
  for (const character of value) {
    if (output.length + character.length > maximum) break;
    output += character;
  }
  return output;
}
function title(value: string): string {
  const plain = Array.from(value, (char) => {
    const code = char.codePointAt(0) as number;
    return code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      (code >= 0xd800 && code <= 0xdfff)
      ? " "
      : char;
  })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return bounded(plain, 256) || "Korisnik";
}
function project(row: ChatThread): ChatThread {
  return {
    id: row.id,
    kind: row.kind,
    inbox: row.inbox,
    title: title(row.title),
    targetId: row.targetId,
    canSend: row.canSend,
    blockedByMe: row.blockedByMe,
    blocked: row.blocked,
    latestSequence: row.latestSequence,
    readSequence: row.readSequence,
    unreadCount: row.unreadCount,
    lastMessage: row.lastMessage
      ? { body: bounded(row.lastMessage.body, 200), createdAt: row.lastMessage.createdAt }
      : null,
  };
}
async function threadView(client: PoolClient, actorId: string, id: string): Promise<ChatThread> {
  const row = (
    await client.query<ChatThread>(
      `SELECT ${columns} FROM message_thread t ${joins} WHERE ${visible} AND t.id=$2`,
      [actorId, id],
    )
  ).rows[0];
  if (!row) fail(404, "THREAD_NOT_FOUND");
  return project(row);
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function receipt(
  client: PoolClient,
  actor: string,
  key: string,
  intent: string,
): Promise<ChatReceipt | null> {
  const prior = (
    await client.query<ChatReceipt & { fingerprint: string }>(
      'SELECT fingerprint,result_thread_id AS "threadId",result_message_id AS "messageId",result_sequence AS sequence FROM message_command WHERE actor_user_id=$1 AND request_id=$2',
      [actor, key],
    )
  ).rows[0];
  if (!prior) return null;
  if (prior.fingerprint !== intent) fail(409, "IDEMPOTENCY_CONFLICT");
  return { threadId: prior.threadId, messageId: prior.messageId, sequence: prior.sequence };
}
async function record(
  client: PoolClient,
  actor: string,
  key: string,
  operation: "open" | "send" | "block",
  intent: string,
  result: ChatReceipt,
): Promise<ChatReceipt> {
  await rate(client, actor, "command");
  await client.query(
    "INSERT INTO message_command(actor_user_id,request_id,operation,fingerprint,result_thread_id,result_message_id,result_sequence) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [actor, key, operation, intent, result.threadId, result.messageId, result.sequence],
  );
  return result;
}
async function rate(
  client: PoolClient,
  actor: string,
  operation: "open" | "send" | "block" | "command",
) {
  const query =
    operation === "open"
      ? "SELECT count(*)::integer AS n FROM message_thread WHERE created_by_user_id=$1 AND created_at>clock_timestamp()-interval '1 hour'"
      : operation === "send"
        ? "SELECT count(*)::integer AS n FROM message_message WHERE sender_user_id=$1 AND created_at>clock_timestamp()-interval '1 minute'"
        : operation === "block"
          ? "SELECT count(*)::integer AS n FROM message_command WHERE actor_user_id=$1 AND operation='block' AND created_at>clock_timestamp()-interval '1 minute'"
          : "SELECT count(*)::integer AS n FROM message_command WHERE actor_user_id=$1 AND created_at>clock_timestamp()-interval '1 minute'";
  const n = (await client.query<{ n: number }>(query, [actor])).rows[0]?.n;
  if (
    n === undefined ||
    n >= (operation === "open" ? 20 : operation === "send" ? 60 : operation === "block" ? 30 : 240)
  )
    fail(429, "MESSAGING_RATE_LIMIT");
}
function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function createMessagingService({
  accounts,
  auth,
  pool,
}: {
  accounts: AccountService;
  auth: AuthService;
  pool: Pool;
}) {
  async function session(headers: Headers): Promise<SignedSession> {
    return safe(async () => {
      const expectedAccountId = headers.get("X-AhiBizz-Account-ID");
      if (expectedAccountId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
        fail(400, "INVALID_MESSAGING_INPUT");
      const account = await accounts.read(headers),
        value = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        });
      if (!value?.session || value.session.userId !== account.id || value.user.id !== account.id)
        fail(401, "AUTHENTICATION_REQUIRED");
      return {
        id: value.session.id,
        userId: value.session.userId,
        token: value.session.token,
        ...(expectedAccountId === null ? {} : { expectedAccountId }),
      };
    });
  }
  return {
    async list(headers: Headers, input: unknown): Promise<ChatThreadPage> {
      const value = listInput(input),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor } = await authority(client, signed);
        const filter =
          value.inbox === "business"
            ? "t.kind='business' AND t.right_user_id=$1"
            : "(t.kind='person' OR t.left_user_id=$1)";
        const rows = (
          await client.query<ChatThread>(
            `SELECT ${columns} FROM message_thread t ${joins} WHERE ${visible} AND (${filter}) ORDER BY t.updated_at DESC,t.id LIMIT 31 OFFSET $2`,
            [actor.id, (value.page - 1) * 30],
          )
        ).rows;
        return {
          items: rows.slice(0, 30).map(project),
          page: value.page,
          hasMore: rows.length > 30,
        };
      });
    },
    async open(headers: Headers, input: unknown, key: string): Promise<ChatReceipt> {
      const value = openInput(input),
        requestId = uuid(key),
        intent = fingerprint({ operation: "open", ...value }),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const hint =
          value.kind === "business"
            ? (
                await client.query<BusinessRow>(
                  "SELECT id,owner_user_id, CASE WHEN package_allows_listing(b) THEN status ELSE 'draft' END AS status,title FROM directory_business b WHERE id=$1",
                  [value.targetId],
                )
              ).rows[0]
            : null;
        if (value.kind === "business" && !hint) fail(404, "BUSINESS_NOT_FOUND");
        const targetId = hint?.owner_user_id ?? value.targetId;
        const { actor, users } = await authority(client, signed, [targetId]);
        if (actor.id === targetId) fail(400, "SELF_MESSAGE_NOT_ALLOWED");
        const target = users.find((user) => user.id === targetId);
        if (!target) fail(404, value.kind === "person" ? "PERSON_NOT_FOUND" : "BUSINESS_NOT_FOUND");
        const business = hint
          ? ((
              await client.query<BusinessRow>(
                "SELECT id,owner_user_id, CASE WHEN package_allows_listing(b) THEN status ELSE 'draft' END AS status,title FROM directory_business b WHERE id=$1 FOR UPDATE",
                [hint.id],
              )
            ).rows[0] ?? null)
          : null;
        if (hint && (!business || business.owner_user_id !== targetId))
          fail(404, "BUSINESS_NOT_FOUND");
        const prior = await receipt(client, actor.id, requestId, intent);
        if (prior) {
          await threadView(client, actor.id, prior.threadId);
          return prior;
        }
        const ids = [actor.id, targetId].sort(),
          left = value.kind === "person" ? ids[0] : actor.id,
          right = value.kind === "person" ? ids[1] : targetId;
        const existing = (
          await client.query<{ id: string }>(
            `SELECT id FROM message_thread WHERE kind=$1 AND left_user_id=$2 AND right_user_id=$3 AND business_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE`,
            [value.kind, left, right, business?.id ?? null],
          )
        ).rows[0];
        let id = existing?.id;
        if (!id) {
          if (await contactBlocked(client, actor.id, targetId)) fail(409, "MESSAGING_BLOCKED");
          if (!available(target))
            fail(404, value.kind === "person" ? "PERSON_NOT_FOUND" : "BUSINESS_NOT_FOUND");
          if (value.kind === "person") {
            const visibleTarget = await client.query(
              "SELECT user_id FROM personal_profile WHERE user_id=$1 AND is_public=true FOR SHARE",
              [targetId],
            );
            if (!visibleTarget.rowCount) fail(404, "PERSON_NOT_FOUND");
          } else if (business?.status !== "published") fail(404, "BUSINESS_NOT_FOUND");
          await rate(client, actor.id, "open");
          id = randomUUID();
          await client.query(
            "INSERT INTO message_thread(id,kind,left_user_id,right_user_id,business_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)",
            [id, value.kind, left, right, business?.id ?? null, actor.id],
          );
          await client.query(
            "INSERT INTO message_thread_member(thread_id,user_id) VALUES($1,$2),($1,$3)",
            [id, left, right],
          );
        }
        return record(client, actor.id, requestId, "open", intent, {
          threadId: id,
          messageId: null,
          sequence: null,
        });
      });
    },
    async read(headers: Headers, inputId: string, input: unknown): Promise<ChatConversation> {
      const id = uuid(inputId),
        value = readInput(input),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor } = await context(client, signed, id),
          thread = await threadView(client, actor.id, id);
        const rows = (
          await client.query<{
            id: string;
            sequence: number;
            body: string;
            createdAt: Date | string;
            from: "me" | "peer";
          }>(
            "SELECT id,sequence,body,created_at AS \"createdAt\",CASE WHEN sender_user_id=$2 THEN 'me' ELSE 'peer' END AS \"from\" FROM message_message WHERE thread_id=$1 AND ($3::integer IS NULL OR sequence<$3) ORDER BY sequence DESC LIMIT 51",
            [id, actor.id, value.before ?? null],
          )
        ).rows;
        const items: ChatMessage[] = rows
          .slice(0, 50)
          .reverse()
          .map((row) => ({
            id: row.id,
            sequence: row.sequence,
            body: row.body,
            createdAt: iso(row.createdAt),
            from: row.from,
          }));
        return { thread, items, hasMore: rows.length > 50 };
      });
    },
    async send(
      headers: Headers,
      inputId: string,
      input: unknown,
      key: string,
    ): Promise<ChatReceipt> {
      const id = uuid(inputId),
        value = sendInput(input),
        requestId = uuid(key),
        intent = fingerprint({ operation: "send", id, ...value }),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor, thread } = await context(client, signed, id),
          prior = await receipt(client, actor.id, requestId, intent);
        if (prior) return prior;
        const view = await threadView(client, actor.id, id);
        if (view.blocked) fail(409, "MESSAGING_BLOCKED");
        if (!view.canSend) fail(409, "CONVERSATION_UNAVAILABLE");
        if (thread.latest_sequence >= 2147483646) fail(409, "MESSAGE_SEQUENCE_EXHAUSTED");
        await rate(client, actor.id, "send");
        const next = (
          await client.query<{ latest_sequence: number }>(
            "UPDATE message_thread SET latest_sequence=latest_sequence+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING latest_sequence",
            [id],
          )
        ).rows[0];
        if (!next) fail(409, "CONVERSATION_UNAVAILABLE");
        const messageId = randomUUID();
        await client.query(
          "INSERT INTO message_message(id,thread_id,sender_user_id,sequence,body) VALUES($1,$2,$3,$4,$5)",
          [messageId, id, actor.id, next.latest_sequence, value.body],
        );
        return record(client, actor.id, requestId, "send", intent, {
          threadId: id,
          messageId,
          sequence: next.latest_sequence,
        });
      });
    },
    async markRead(
      headers: Headers,
      inputId: string,
      input: unknown,
    ): Promise<{ readSequence: number }> {
      const id = uuid(inputId),
        value = readMarkInput(input),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor, thread } = await context(client, signed, id);
        if (value.throughSequence > thread.latest_sequence) fail(400, "INVALID_MESSAGING_INPUT");
        const state = (
          await client.query<{ readSequence: number }>(
            'UPDATE message_thread_member SET read_sequence=greatest(read_sequence,$3),updated_at=clock_timestamp() WHERE thread_id=$1 AND user_id=$2 RETURNING read_sequence AS "readSequence"',
            [id, actor.id, value.throughSequence],
          )
        ).rows[0];
        if (!state) fail(404, "THREAD_NOT_FOUND");
        return { readSequence: state.readSequence };
      });
    },
    async block(
      headers: Headers,
      inputId: string,
      input: unknown,
      key: string,
    ): Promise<ChatReceipt> {
      const id = uuid(inputId),
        value = blockInput(input),
        requestId = uuid(key),
        intent = fingerprint({ operation: "block", id, ...value }),
        signed = await session(headers);
      return transaction(pool, async (client) => {
        const { actor, thread, peer } = await context(client, signed, id),
          prior = await receipt(client, actor.id, requestId, intent);
        if (prior) return prior;
        await rate(client, actor.id, "block");
        if (thread.kind === "person" && peer)
          await writePeopleBlock(client, actor.id, peer.id, value.blocked);
        else
          await client.query(
            "UPDATE message_thread_member SET blocked=$3,updated_at=clock_timestamp() WHERE thread_id=$1 AND user_id=$2",
            [id, actor.id, value.blocked],
          );
        return record(client, actor.id, requestId, "block", intent, {
          threadId: id,
          messageId: null,
          sequence: null,
        });
      });
    },
  };
}
export type MessagingService = ReturnType<typeof createMessagingService>;
let service: MessagingService | undefined;
export function getMessagingService(): MessagingService | null {
  if (service) return service;
  const accounts = getAccountService(),
    auth = getAuthService(),
    pool = getAuthDatabasePool();
  if (!accounts || !auth || !pool) return null;
  service = createMessagingService({ accounts, auth, pool });
  return service;
}
