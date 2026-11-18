import { deliverNextApprovalEmail } from "./approval-email";
import { readAuthConfiguration } from "./config";
import { createSmtpSender } from "./mail";
import { getAuthDatabasePool } from "./service";

let started = false;
export function startApprovalEmailWorker() {
  if (started) return;
  const config = readAuthConfiguration();
  const pool = config && getAuthDatabasePool();
  if (!config || !pool) return;
  started = true;
  const sender = createSmtpSender(config.smtp);
  const tick = async () => {
    try {
      for (let count = 0; count < 10; count++) {
        const result = await deliverNextApprovalEmail(pool, config.baseURL, sender);
        if (result === "idle") break;
        if (result === "failed") console.error("Account approval email delivery failed.");
      }
    } catch {
      console.error("Account approval email queue unavailable.");
    } finally {
      setTimeout(tick, 15000).unref();
    }
  };
  void tick();
}
