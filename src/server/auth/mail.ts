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
    } catch {
      throw new AuthEmailDeliveryError();
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
