import { helpTicketTopic } from "../lib/help-center";
import { supportTarget } from "../lib/support-requests";
import {
  type OwnRequestOptions,
  onlyKey,
  openOwnRequest,
  ownFailure,
  ownReply,
  readOwnChange,
} from "./account-own-request";
import { getAuthService, readAuthConfiguration } from "./auth/service";
import { getSupportRequests } from "./support-requests";

type Submit = (
  headers: Headers,
  subject: unknown,
  reference: unknown,
  details: unknown,
) => Promise<unknown>;

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

/**
 * "Kontakt" as JSON, for the native app: one question to support, under a help topic.
 *
 * POST /api/support/requests {"topic": "nalog", "details": "…", "key": "<uuid>"} → { sent: true }
 *
 * The key is made by the app for each message, so a repeated send of the same message is stored
 * once. It is the same service as the website's form: the same length limit, the same ten
 * requests a day, and the answer goes to the email of the account.
 */
export function createSupportRequestHandler(
  options: OwnRequestOptions & { submit: () => Submit | null },
) {
  return async function supportRequest(request: Request): Promise<Response> {
    try {
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      if (!opened.change) return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
      const submit = options.submit();
      if (!submit) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
      const payload = await readOwnChange(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return ownReply({ code: "INVALID_REQUEST" }, 400);
      const body = payload as Record<string, unknown>;
      const keys = Object.keys(body).sort().join(",");
      const reference = `${String(body.topic)}--${String(body.key)}`;
      if (
        keys !== "details,key,topic" ||
        typeof body.topic !== "string" ||
        typeof body.key !== "string" ||
        !uuid.test(body.key) ||
        typeof body.details !== "string" ||
        !helpTicketTopic(reference)
      )
        return ownReply({ code: "INVALID_REQUEST" }, 400);
      await submit(request.headers, "help", reference, body.details);
      return ownReply({ sent: true });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleSupportRequest = createSupportRequestHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
  submit: () => {
    const service = getSupportRequests();
    return service ? service.submit.bind(service) : null;
  },
});

/**
 * "Brisanje naloga" as JSON, for the native app: the same request as the website's form.
 *
 * POST /api/support/deletion {"confirm": true} → { sent: true }
 *
 * It only records the request; support checks who sent it and carries it out by hand, as the
 * page says. Sending it again while one is open changes nothing.
 */
export function createDeletionRequestHandler(
  options: OwnRequestOptions & { submit: () => Submit | null },
) {
  return async function deletionRequest(request: Request): Promise<Response> {
    try {
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      if (!opened.change) return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
      const submit = options.submit();
      if (!submit) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
      const [key, value] = onlyKey(await readOwnChange(request)) ?? [];
      if (key !== "confirm" || value !== true) return ownReply({ code: "INVALID_REQUEST" }, 400);
      await submit(request.headers, "deletion", "", "");
      return ownReply({ sent: true });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleDeletionRequest = createDeletionRequestHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
  submit: () => {
    const service = getSupportRequests();
    return service ? service.submit.bind(service) : null;
  },
});

// The reasons drawn on "Prijavi sadržaj"; the chosen one opens the text support reads.
const reportReasons: Record<string, string> = {
  fake: "Lažan profil ili djelatnost",
  fraud: "Prevara ili traženje novca",
  hate: "Uvreda ili govor mržnje",
  inappropriate: "Neprimjeren sadržaj",
  other: "Nešto drugo",
};

/**
 * "Prijavi sadržaj" as JSON, for the native app: a report of a profile, a business, a review, a
 * conversation or a reel.
 *
 * POST /api/support/reports {"subject": "reel", "reference": "<id>", "reason": "hate", "details": "…"}
 *   → { sent: true }
 *
 * It is the website's report under the same subjects and the same daily limit. The reason is one
 * of the listed keys and is written in front of the person's own words, which may be empty.
 */
export function createContentReportHandler(
  options: OwnRequestOptions & { submit: () => Submit | null },
) {
  return async function contentReport(request: Request): Promise<Response> {
    try {
      const opened = await openOwnRequest(request, options);
      if (opened instanceof Response) return opened;
      if (!opened.change) return ownReply({ code: "METHOD_NOT_ALLOWED" }, 405);
      const submit = options.submit();
      if (!submit) return ownReply({ code: "ACCOUNT_UNAVAILABLE" }, 503);
      const payload = await readOwnChange(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return ownReply({ code: "INVALID_REQUEST" }, 400);
      const body = payload as Record<string, unknown>;
      const target = supportTarget(body.subject, body.reference);
      const reason = typeof body.reason === "string" ? reportReasons[body.reason] : undefined;
      if (
        Object.keys(body).sort().join(",") !== "details,reason,reference,subject" ||
        !target ||
        target.subject === "deletion" ||
        target.subject === "help" ||
        !Object.hasOwn(reportReasons, String(body.reason)) ||
        !reason ||
        typeof body.details !== "string"
      )
        return ownReply({ code: "INVALID_REQUEST" }, 400);
      const words = body.details.trim();
      await submit(
        request.headers,
        target.subject,
        target.reference,
        words ? `${reason}. ${words}` : `${reason}.`,
      );
      return ownReply({ sent: true });
    } catch (error) {
      return ownFailure(error);
    }
  };
}

export const handleContentReport = createContentReportHandler({
  auth: getAuthService,
  baseURL: () => readAuthConfiguration()?.baseURL ?? null,
  submit: () => {
    const service = getSupportRequests();
    return service ? service.submit.bind(service) : null;
  },
});
