/**
 * The oldest version of the native app that still works with this server. An app older than this
 * shows "Stigla je nova verzija" and nothing else. Raise it only when an old app would break or
 * mislead; every raise locks people out until they update, so it is the owner's decision.
 */
export const minimumAppVersion = "1.0.0";

/** Whether a version like "1.4.2" is older than another; anything unreadable counts as not older. */
export function olderThan(version: string, minimum: string) {
  const parts = (text: string) => text.split(".").map((part) => Number(part));
  const [a, b] = [parts(version), parts(minimum)];
  if (![...a, ...b].every((part) => Number.isInteger(part) && part >= 0)) return false;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0,
      right = b[index] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
}
