import type { DirectoryBusiness } from "../server/directory/types";
import { DirectoryRequestError } from "./directory-create-submission";

export type DirectoryReply = {
  business?: DirectoryBusiness;
  items?: DirectoryBusiness[];
  categories?: { id: string; name: string; parentId: string | null }[];
  hasMore?: boolean;
};
export type DirectoryRequest = (path: string, options?: RequestInit) => Promise<DirectoryReply>;

function validDirectoryPath(path: string): boolean {
  if (path.length > 8192 || /[#\\\s]/.test(path)) return false;
  const separator = path.indexOf("?");
  const route = separator === -1 ? path : path.slice(0, separator);
  if (route !== "mine" && route !== "admin" && route !== "review")
    return (
      separator === -1 &&
      /^(?:categories|mine\/[A-Za-z0-9_-]{1,128}(?:\/(?:publish|archive|recover))?|review\/[A-Za-z0-9_-]{1,128})$/.test(
        route,
      )
    );
  if (separator === -1) return true;
  const raw = path.slice(separator + 1);
  if (!raw || /%(?![0-9a-f]{2})/i.test(raw)) return false;
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (seen.has(key)) return false;
    seen.add(key);
    switch (key) {
      case "page":
        if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 500) return false;
        break;
      case "pageSize":
        if (value !== "20" && value !== "50") return false;
        break;
      case "status":
        if (route === "review" || !["draft", "pending", "published", "archived"].includes(value))
          return false;
        break;
      case "q":
        if (
          value.length > 120 ||
          Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        )
          return false;
        break;
      default:
        return false;
    }
  }
  return seen.size > 0;
}

export const directoryRequest: DirectoryRequest = async (path, options = {}) => {
  if (!validDirectoryPath(path)) throw new DirectoryRequestError("INVALID_DIRECTORY_INPUT", 400);
  const response = await fetch(`/api/directory/${path}`, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new DirectoryRequestError(
      typeof data?.code === "string" ? data.code : "UNAVAILABLE",
      response.status,
    );
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new DirectoryRequestError("UNAVAILABLE");
  return data;
};

export function directoryActorRequest(
  expectedAccountId: string | undefined,
  request: DirectoryRequest = directoryRequest,
): DirectoryRequest {
  return (path, options = {}) => {
    if (!expectedAccountId || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedAccountId))
      return Promise.reject(new DirectoryRequestError("ACCOUNT_IDENTITY_CHANGED", 401));
    const headers = new Headers(options.headers);
    headers.set("X-AhiBizz-Account-ID", expectedAccountId);
    return request(path, { ...options, headers });
  };
}

export function directoryAccessDenied(failure: unknown): boolean {
  return (
    failure !== null &&
    typeof failure === "object" &&
    "status" in failure &&
    (failure.status === 401 || failure.status === 403)
  );
}
