import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = process.env.PORT;

if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error("Set PORT to a valid port before starting the production server.");
  process.exit(1);
}

const server = [path.join(root, ".next/standalone/server.js"), path.join(root, "server.js")].find(
  existsSync,
);

if (!server) {
  console.error("Standalone server missing. Run the production build first.");
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: "production", HOSTNAME: "0.0.0.0" };
let stopping = false;

function run(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd: root, env, stdio: "inherit" });
    const forward = (signal) => {
      stopping = true;
      child.kill(signal);
    };
    const onTerm = () => forward("SIGTERM");
    const onInt = () => forward("SIGINT");
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
    const cleanup = () => {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve(code ?? (signal === "SIGINT" ? 130 : 143));
    });
  });
}

try {
  if (process.env.DATABASE_URL !== undefined) {
    const code = await run(path.join(root, "scripts/migrate.mjs"));
    if (code !== 0 || stopping) process.exit(code || 1);
  } else {
    console.warn("DATABASE_URL is not configured; starting without database readiness.");
  }
  if (!stopping) process.exitCode = await run(server);
} catch {
  console.error("Production startup failed before the server could finish.");
  process.exitCode = 1;
}
