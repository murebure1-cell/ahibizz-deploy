import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "src");
// The first argument of t(), msg() or titled() when it is a plain string literal.
const call = /(?<![\w.])(?:t|msg|titled)\(\s*"((?:[^"\\]|\\.)*)"/g;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every Bosnian interface text marked for translation in src, with the files that use it. */
export function sourceTexts() {
  const texts = new Map<string, string[]>();
  for (const file of files(root)) {
    if (file.includes(`${join("lib", "i18n")}`)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(call)) {
      const text = JSON.parse(`"${match[1]}"`) as string;
      texts.set(text, [...(texts.get(text) ?? []), file.slice(root.length + 1)]);
    }
  }
  return texts;
}
