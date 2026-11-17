import { spawn } from "node:child_process";
import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createIngressForwarder } from "./ingress-forwarder.mjs";
import { isValidatedIngressPolicy } from "./ingress-policy.mjs";

function healthy(port) {
  return new Promise((resolve) => {
    const probe = request(
      { host: "127.0.0.1", port, method: "GET", path: "/api/health/live", timeout: 1000 },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1024) response.destroy();
        });
        response.on("error", () => resolve(false));
        response.on("end", () => {
          try {
            resolve(response.statusCode === 200 && JSON.parse(body).status === "ok");
          } catch {
            resolve(false);
          }
        });
      },
    );
    probe.on("error", () => resolve(false));
    probe.on("timeout", () => probe.destroy());
    probe.end();
  });
}

/** One public listener; an unexpected child exit closes it instead of retaining a stale proxy. */
export async function runEnforcedServer({
  root,
  server,
  env,
  policy,
  startupTimeoutMs = 60_000,
  shutdownGraceMs = 10_000,
}) {
  if (!isValidatedIngressPolicy(policy)) throw new Error("A validated ingress policy is required.");
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 60_000)
    throw new Error("Invalid startup timeout.");
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 0 || shutdownGraceMs > 30_000)
    throw new Error("Invalid shutdown grace period.");
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: {
      ...env,
      HOSTNAME: "127.0.0.1",
      PORT: String(policy.internalPort),
      AHIBIZZ_INGRESS_WRAPPED: "true",
      AHIBIZZ_INGRESS_PUBLIC_PORT: String(policy.publicPort),
    },
    stdio: "inherit",
  });
  let exited = false;
  const childExit = new Promise((resolve) => {
    const finish = (code) => {
      if (exited) return;
      exited = true;
      resolve(code);
    };
    child.once("error", () => finish(1));
    child.once("exit", (code, signal) => finish(code ?? (signal === "SIGINT" ? 130 : 143)));
  });
  let stopping;
  let announceStop;
  const requestedStop = new Promise((resolve) => {
    announceStop = resolve;
  });
  const stop = (signal) => {
    if (stopping) return;
    stopping = signal;
    announceStop(signal);
  };
  const onTerm = () => stop("SIGTERM");
  const onInt = () => stop("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  const forwarder = createIngressForwarder({ policy });
  const close = async () => {
    if (forwarder.server.listening) await forwarder.close(shutdownGraceMs);
  };
  const stopChild = async () => {
    if (exited) return;
    child.kill(stopping || "SIGTERM");
    const result = await Promise.race([
      childExit.then(() => true),
      delay(shutdownGraceMs, false, { ref: false }),
    ]);
    if (!result && !exited) {
      child.kill("SIGKILL");
      await childExit;
    }
  };
  try {
    const deadline = Date.now() + startupTimeoutMs;
    while (!exited && !stopping && Date.now() < deadline) {
      if (await healthy(policy.internalPort)) break;
      await delay(50);
    }
    if (exited || stopping || Date.now() >= deadline)
      throw new Error("Server did not become ready.");
    await new Promise((resolve, reject) => {
      forwarder.server.once("error", reject);
      forwarder.server.listen(policy.publicPort, "0.0.0.0", () => {
        forwarder.server.off("error", reject);
        resolve();
      });
    });
    if (exited || stopping) throw new Error("Server stopped before ingress was ready.");
    const outcome = await Promise.race([
      childExit.then((code) => ({ code })),
      requestedStop.then((signal) => ({ signal })),
    ]);
    await close();
    if (outcome.signal) {
      await stopChild();
      return outcome.signal === "SIGINT" ? 130 : 143;
    }
    console.error("The application child stopped; the ingress listener was closed.");
    return outcome.code || 1;
  } catch {
    console.error("Enforced ingress startup could not become ready.");
    return stopping === "SIGINT" ? 130 : stopping ? 143 : 1;
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
    await close();
    await stopChild();
  }
}
