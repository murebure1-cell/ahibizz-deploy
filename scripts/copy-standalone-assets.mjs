import { cp, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const standalone = path.join(root, ".next/standalone");

function requireInside(parent, location) {
  const relative = path.relative(parent, location);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Standalone asset path must stay inside the project.");
  }
}

async function requireDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Standalone assets require ordinary directories.");
  }
  requireInside(root, await realpath(directory));
}

await requireDirectory(standalone);

for (const relative of ["public", ".next/static"]) {
  const source = path.join(root, relative);
  const destination = path.join(standalone, relative);
  await requireDirectory(source);
  await requireDirectory(path.dirname(destination));
  requireInside(standalone, destination);
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: async (from, to) => {
      requireInside(standalone, to);
      if ((await lstat(from)).isSymbolicLink()) {
        throw new Error("Standalone assets must not contain symbolic links.");
      }
      const existing = await lstat(to).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      if (existing?.isSymbolicLink()) {
        throw new Error("Standalone asset destination must not contain symbolic links.");
      }
      return true;
    },
  });
  await requireDirectory(destination);
}

console.log("Prepared standalone public and static assets.");
