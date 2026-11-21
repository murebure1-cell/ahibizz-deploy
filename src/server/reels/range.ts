/** An individual byte range is enough for native seek and Safari's media probe. */
export function readReelRange(value: string | null, size: number) {
  if (value === null) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start < size && end >= start ? { start, end } : null;
}
