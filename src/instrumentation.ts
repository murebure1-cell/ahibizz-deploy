export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startApprovalEmailWorker } = await import("./server/auth/approval-worker");
    try {
      startApprovalEmailWorker();
    } catch {
      console.error("Account approval email worker could not start.");
    }
    const { startPushWorker } = await import("./server/push/worker");
    try {
      startPushWorker();
    } catch {
      console.error("Push worker could not start.");
    }
  }
}
