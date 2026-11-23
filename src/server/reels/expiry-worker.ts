import { getDatabase } from "../db";
import { expireReels } from "./service";

const runtime = globalThis as typeof globalThis & {
  __ahiReelExpiry?: ReturnType<typeof setInterval>;
};

/**
 * Runs inside the server process, so Reels expire and their media is deleted on time whether or not
 * anyone opens the app. Public reads also hide a Reel after 24 hours, so a late sweep never shows it.
 */
export function startReelExpiryWorker(intervalMs = 60_000) {
  if (runtime.__ahiReelExpiry || process.env.NEXT_PHASE === "phase-production-build") return;
  const database = getDatabase();
  if (!database.configured()) return;
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      // Drain a backlog in bounded batches, then wait for the next interval.
      for (let round = 0; round < 10; round++) {
        const result = await expireReels(database);
        if (result.expired < 200 && result.abandoned < 200) break;
      }
    } catch {
      console.error("Reel expiry sweep unavailable.");
    } finally {
      running = false;
    }
  };
  runtime.__ahiReelExpiry = setInterval(sweep, intervalMs);
  runtime.__ahiReelExpiry.unref();
  void sweep();
}
