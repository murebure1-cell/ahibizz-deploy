function duplicateKeys(text: string) {
  const seen = new Set<string>();
  let depth = 0,
    keyExpected = false;
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (c === '"') {
      const start = index;
      while (++index < text.length) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      if (depth === 1 && keyExpected) {
        const key = JSON.parse(text.slice(start, index + 1)) as string;
        if (seen.has(key)) return true;
        seen.add(key);
        keyExpected = false;
      }
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) keyExpected = true;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) keyExpected = true;
  }
  return false;
}
export async function readFlatJson(request: Request, invalid: () => never, tooLarge: () => never) {
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      value: unknown = JSON.parse(text);
    if (duplicateKeys(text)) invalid();
    return value;
  } catch {
    invalid();
  }
}
