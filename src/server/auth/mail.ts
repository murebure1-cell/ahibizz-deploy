import nodemailer from "nodemailer";
import type { SmtpConfiguration } from "./config";

export type AuthEmail = Readonly<{
  kind: "verification" | "password-reset";
  to: string;
  url: string;
}>;
export type AuthEmailSender = (message: AuthEmail) => Promise<void>;
export type ApprovalEmail = Readonly<{
  kind: "account-approved";
  to: string;
  url: string;
  decisionId: string;
}>;
export type ApprovalEmailSender = (message: ApprovalEmail) => Promise<void>;

export class AuthEmailDeliveryError extends Error {
  constructor() {
    super("Authentication email could not be sent.");
  }
}

const mailKinds = new Set(["verification", "password-reset", "account-approved"]);
const smtpCodes = new Set([
  "EAUTH",
  "EENVELOPE",
  "EMESSAGE",
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ETLS",
  "EREQUIRETLS",
  "EPROTOCOL",
  "ESTREAM",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);
const smtpCommands = new Set([
  "API",
  "CONN",
  "EHLO",
  "HELO",
  "STARTTLS",
  "AUTH LOGIN",
  "AUTH PLAIN",
  "AUTH CRAM-MD5",
  "AUTH XOAUTH2",
  "MAIL FROM",
  "RCPT TO",
  "DATA",
  "RSET",
]);
const failureWindows = new Map<string, { since: number; count: number }>();

function deliveryFailure(
  kind: AuthEmail["kind"] | ApprovalEmail["kind"],
  stage: "link" | "recipient" | "smtp",
  error?: unknown,
) {
  const safeKind = mailKinds.has(kind) ? kind : "unknown";
  const now = Date.now();
  let window = failureWindows.get(safeKind);
  if (!window || now - window.since >= 60_000) {
    window = { since: now, count: 0 };
    failureWindows.set(safeKind, window);
  }
  if (window.count < 5) {
    window.count++;
    const smtp = (error ?? {}) as { code?: unknown; command?: unknown; responseCode?: unknown };
    // SMTP's response, message, envelope and stack may contain recipient details or secrets.
    console.error("auth_mail_delivery_failed", {
      kind: safeKind,
      stage,
      ...(stage === "smtp"
        ? {
            code: typeof smtp.code === "string" && smtpCodes.has(smtp.code) ? smtp.code : "OTHER",
            command:
              typeof smtp.command === "string" && smtpCommands.has(smtp.command)
                ? smtp.command
                : "OTHER",
            status:
              typeof smtp.responseCode === "number" &&
              Number.isInteger(smtp.responseCode) &&
              smtp.responseCode >= 400 &&
              smtp.responseCode <= 599
                ? smtp.responseCode
                : null,
          }
        : {}),
    });
  }
  return new AuthEmailDeliveryError();
}

export function guardedAuthEmailSender(baseURL: string, sender: AuthEmailSender): AuthEmailSender {
  return async (message) => {
    const target = URL.canParse(message.url) ? new URL(message.url) : null;
    if (
      !target ||
      target.origin !== baseURL ||
      !target.pathname.startsWith("/api/auth/") ||
      target.username ||
      target.password
    ) {
      throw deliveryFailure(message.kind, "link");
    }
    if (/[\r\n]/.test(message.to)) throw deliveryFailure(message.kind, "recipient");
    try {
      await sender(message);
    } catch (error) {
      if (error instanceof AuthEmailDeliveryError) throw error;
      throw deliveryFailure(message.kind, "smtp", error);
    }
  };
}

/** The SMTP transport is not constructed until an email is actually requested. */
export function createSmtpSender(config: SmtpConfiguration) {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  return async (message: AuthEmail | ApprovalEmail): Promise<void> => {
    const { to } = message;
    try {
      if (!transport)
        transport = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          requireTLS: !config.secure,
          auth: { user: config.user, pass: config.password },
          tls: { rejectUnauthorized: true },
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 10000,
          logger: false,
          debug: false,
        });
      const content = emailContent(message);
      await transport.sendMail({
        from: config.from,
        to: { name: "", address: to },
        ...(message.kind === "account-approved"
          ? { messageId: `<approval-${message.decisionId}@${config.from.split("@")[1]}>` }
          : {}),
        ...content,
      });
    } catch (error) {
      throw deliveryFailure(message.kind, "smtp", error);
    }
  };
}

export function emailContent(message: AuthEmail | ApprovalEmail) {
  switch (message.kind) {
    case "account-approved":
      return {
        subject: "Nalog je odobren — AhiBizz",
        text: `Tvoj AhiBizz nalog je odobren. Možeš se prijaviti ovdje:\n\n${message.url}`,
      };
    case "verification":
      return {
        subject: "Potvrdite email — AhiBizz",
        text: `Za potvrdu email adrese otvorite link:\n\n${message.url}\n\nAko niste tražili nalog, zanemarite ovu poruku.`,
      };
    case "password-reset":
      return {
        subject: "Promjena lozinke — AhiBizz",
        text: `Za promjenu lozinke otvorite link:\n\n${message.url}\n\nAko niste tražili promjenu, zanemarite ovu poruku.`,
      };
  }
}
