import nodemailer from "nodemailer";
import type { SmtpConfiguration } from "./config";

export type AuthEmail = Readonly<{
  kind: "verification" | "password-reset";
  to: string;
  url: string;
}>;
export type AuthEmailSender = (message: AuthEmail) => Promise<void>;

export class AuthEmailDeliveryError extends Error {
  constructor() {
    super("Authentication email could not be sent.");
  }
}

/** The SMTP transport is not constructed until an email is actually requested. */
export function createSmtpSender(config: SmtpConfiguration): AuthEmailSender {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  return async ({ kind, to, url }) => {
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
      await transport.sendMail({
        from: config.from,
        to,
        subject:
          kind === "verification" ? "Potvrdite email — AhiBizz" : "Promjena lozinke — AhiBizz",
        text:
          kind === "verification"
            ? `Za potvrdu email adrese otvorite link:\n\n${url}\n\nAko niste tražili nalog, zanemarite ovu poruku.`
            : `Za promjenu lozinke otvorite link:\n\n${url}\n\nAko niste tražili promjenu, zanemarite ovu poruku.`,
      });
    } catch {
      throw new AuthEmailDeliveryError();
    }
  };
}
