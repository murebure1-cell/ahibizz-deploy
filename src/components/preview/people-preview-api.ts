import {
  isProfileCountryCode,
  type PersonalProfile,
  type PersonalProfileFields,
  type ProfileImageKind,
  workStatusLabels,
} from "../../lib/people";
import {
  ProfileRequestError,
  type peopleRequest,
  readPersonalProfile,
} from "../../lib/people-client";

async function previewImage(blob: Blob, kind: ProfileImageKind) {
  if (blob.size === 0 || !["image/png", "image/jpeg", "image/webp"].includes(blob.type))
    throw new ProfileRequestError(400, "MEDIA_INVALID");
  if (blob.size > 4 * 1024 * 1024) throw new ProfileRequestError(413, "MEDIA_TOO_LARGE");
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const signature =
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) ||
    (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
  if (!signature || typeof createImageBitmap !== "function")
    throw new ProfileRequestError(400, "MEDIA_INVALID");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 16_000_000)
      throw new ProfileRequestError(413, "MEDIA_TOO_LARGE");
    const width = kind === "photo" ? 512 : 1600,
      height = kind === "photo" ? 512 : 600;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new ProfileRequestError(400, "MEDIA_INVALID");
    const ratio = Math.max(width / bitmap.width, height / bitmap.height),
      w = bitmap.width * ratio,
      h = bitmap.height * ratio;
    context.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
    const image = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("image_unavailable"))),
        "image/webp",
        0.84,
      ),
    );
    if (image.size > 1048576) throw new ProfileRequestError(413, "MEDIA_TOO_LARGE");
    return image;
  } finally {
    bitmap.close();
  }
}

/** Owner-private, memory-only demonstration. This transport never sends a request. */
export function createPeoplePreviewApi() {
  let profile: PersonalProfile = {
    id: "preview-person",
    name: "Ogledni profil",
    birthDate: null,
    city: null,
    countryCode: null,
    bio: null,
    skills: [],
    workStatus: "not_specified",
    version: 0,
    photoVersion: null,
    coverVersion: null,
    canCustomizeCover: true,
  };
  const images: Record<ProfileImageKind, string | null> = { photo: null, cover: null },
    listeners = new Set<() => void>();
  let revision = 0,
    lifetime = 0;
  let isPublic = false;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const request: typeof peopleRequest = async (path, options = {}) => {
    const currentLifetime = lifetime;
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const method = (options.method ?? "GET").toUpperCase();
    if (path === "me" && method === "GET") return { profile: structuredClone(profile) };
    if (path === "me" && method === "PATCH") {
      let input: unknown;
      try {
        input = JSON.parse(String(options.body));
      } catch {
        throw new ProfileRequestError(400, "INVALID_PROFILE_INPUT");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new ProfileRequestError(400, "INVALID_PROFILE_INPUT");
      const value = input as PersonalProfileFields & { expectedVersion: number };
      const allowed = [
        "expectedVersion",
        "name",
        "birthDate",
        "city",
        "countryCode",
        "bio",
        "skills",
        "workStatus",
      ];
      if (
        Object.keys(value).some((key) => !allowed.includes(key)) ||
        allowed.some((key) => !Object.hasOwn(value, key)) ||
        !Number.isInteger(value.expectedVersion) ||
        value.expectedVersion < 0 ||
        value.expectedVersion > 2147483646 ||
        typeof value.name !== "string" ||
        !value.name.trim() ||
        value.name.length > 100 ||
        !Array.isArray(value.skills) ||
        value.skills.length > 15 ||
        value.skills.some(
          (skill) => typeof skill !== "string" || !skill.trim() || skill.length > 40,
        ) ||
        typeof value.workStatus !== "string" ||
        !Object.hasOwn(workStatusLabels, value.workStatus) ||
        (value.countryCode !== null && !isProfileCountryCode(value.countryCode))
      )
        throw new ProfileRequestError(400, "INVALID_PROFILE_INPUT");
      const { expectedVersion: _version, ...fields } = value;
      if (value.expectedVersion !== profile.version)
        throw new ProfileRequestError(409, "VERSION_CONFLICT");
      let next: PersonalProfile;
      try {
        next = readPersonalProfile({
          ...profile,
          ...structuredClone(fields),
          version: profile.version + 1,
        });
      } catch {
        throw new ProfileRequestError(400, "INVALID_PROFILE_INPUT");
      }
      const control = (input: string, multiline = false) =>
        [...input].some((character) => {
          const code = character.charCodeAt(0);
          return (
            (code < 32 && !(multiline && [10, 13].includes(code))) ||
            code === 127 ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069)
          );
        });
      if (
        (next.birthDate !== null &&
          (next.birthDate < "0001-01-01" ||
            next.birthDate > new Date().toISOString().slice(0, 10))) ||
        control(next.name) ||
        (next.city !== null && (!next.city.trim() || control(next.city))) ||
        (next.bio !== null && (!next.bio.trim() || control(next.bio, true))) ||
        next.skills.some((skill) => control(skill)) ||
        new Set(next.skills.map((skill) => skill.trim().normalize("NFKC").toLowerCase())).size !==
          next.skills.length
      )
        throw new ProfileRequestError(400, "INVALID_PROFILE_INPUT");
      profile = {
        ...next,
        name: next.name.trim(),
        city: next.city?.trim() ?? null,
        bio: next.bio?.trim() ?? null,
        skills: next.skills.map((skill) => skill.trim()),
      };
      changed();
      return { profile: structuredClone(profile) };
    }
    const media = /^me\/media\/(photo|cover)$/.exec(path),
      kind = media?.[1] as ProfileImageKind | undefined;
    if (!kind || !["PUT", "DELETE"].includes(method))
      throw new ProfileRequestError(404, "NOT_FOUND");
    const match = /^"(\d+)"$/.exec(new Headers(options.headers).get("If-Match") ?? "");
    if (!match || Number(match[1]) !== profile.version)
      throw new ProfileRequestError(409, "VERSION_CONFLICT");
    if (kind === "cover" && !profile.canCustomizeCover && method !== "DELETE")
      throw new ProfileRequestError(403, "COVER_NOT_ALLOWED");
    let nextUrl: string | null = null;
    if (method === "PUT") {
      if (!(options.body instanceof Blob)) throw new ProfileRequestError(400, "MEDIA_INVALID");
      const image = await previewImage(options.body, kind);
      if (currentLifetime !== lifetime || options.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      nextUrl = URL.createObjectURL(image);
      if (Number(match[1]) !== profile.version) {
        URL.revokeObjectURL(nextUrl);
        throw new ProfileRequestError(409, "VERSION_CONFLICT");
      }
    }
    if (images[kind]) URL.revokeObjectURL(images[kind]);
    images[kind] = nextUrl;
    profile = {
      ...profile,
      version: profile.version + 1,
      ...(kind === "photo"
        ? { photoVersion: nextUrl ? profile.version + 1 : null }
        : { coverVersion: nextUrl ? profile.version + 1 : null }),
    };
    changed();
    return { profile: structuredClone(profile) };
  };
  return {
    request,
    getProfile: () => structuredClone(profile),
    getVisibility: () => ({ isPublic, profileVersion: profile.version }),
    setVisibility(next: boolean, expectedVersion: number) {
      if (expectedVersion !== profile.version)
        throw new ProfileRequestError(409, "VERSION_CONFLICT");
      isPublic = next;
      profile = { ...profile, version: profile.version + 1 };
      changed();
      return { isPublic, profileVersion: profile.version };
    },
    imageUrl: (kind: ProfileImageKind) => images[kind],
    snapshotVersion: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      lifetime++;
      for (const kind of ["photo", "cover"] as const) {
        const url = images[kind];
        if (url) URL.revokeObjectURL(url);
        images[kind] = null;
      }
      listeners.clear();
    },
  };
}
