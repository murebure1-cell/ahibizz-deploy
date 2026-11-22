export type AdPreferenceGender = "women" | "men" | null;

export function readAdPreference(value: unknown): AdPreferenceGender {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("gender" in value) ||
    (value.gender !== null && value.gender !== "women" && value.gender !== "men")
  )
    throw new Error("INVALID_AD_PREFERENCE");
  return value.gender;
}

/** Reads begun before a save cannot replace its result; a reopened panel waits for the save. */
export function createAdPreferenceEpoch() {
  let epoch = 0;
  let writing: number | null = null;
  return {
    read() {
      return writing === null ? ++epoch : null;
    },
    acceptsRead(token: number) {
      return writing === null && token === epoch;
    },
    endRead(token: number) {
      if (writing === null && token === epoch) epoch++;
    },
    write() {
      if (writing !== null) return null;
      writing = ++epoch;
      return writing;
    },
    acceptsWrite(token: number) {
      return writing === token && token === epoch;
    },
    endWrite(token: number) {
      if (writing !== token || token !== epoch) return false;
      writing = null;
      return true;
    },
    clear() {
      epoch++;
      writing = null;
    },
  };
}
