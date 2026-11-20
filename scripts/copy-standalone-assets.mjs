import { cp, lstat, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
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

// Next traces the native binding, but Windows loads its companion DLLs at runtime.
const packagedRequire = createRequire(path.join(standalone, "server.js"));
const packagedSharp = await realpath(packagedRequire.resolve("sharp"));
requireInside(standalone, packagedSharp);
if (process.platform === "win32") {
  const nativePackage = `@img/sharp-win32-${process.arch}/package`;
  const sourceRequire = createRequire(createRequire(import.meta.url).resolve("sharp"));
  const nativeSource = path.dirname(await realpath(sourceRequire.resolve(nativePackage)));
  const nativeTarget = path.dirname(
    await realpath(createRequire(packagedSharp).resolve(nativePackage)),
  );
  requireInside(root, nativeSource);
  requireInside(standalone, nativeTarget);
  const sourceLib = path.join(nativeSource, "lib");
  const targetLib = path.join(nativeTarget, "lib");
  await requireDirectory(sourceLib);
  await requireDirectory(targetLib);
  for (const file of await readdir(sourceLib, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith(".dll")) {
      await cp(path.join(sourceLib, file.name), path.join(targetLib, file.name));
    }
  }
}
await packagedRequire("sharp")({
  create: { width: 1, height: 1, channels: 3, background: "#ffffff" },
})
  .png()
  .toBuffer();
console.log("Prepared standalone assets and verified image processing.");
