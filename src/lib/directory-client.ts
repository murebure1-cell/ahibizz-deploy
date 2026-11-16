import type { DirectoryBusiness } from "../server/directory/types";
import { DirectoryRequestError } from "./directory-create-submission";

export type DirectoryReply = {
  business?: DirectoryBusiness;
  items?: DirectoryBusiness[];
  categories?: { id: string; name: string; parentId: string | null }[];
  hasMore?: boolean;
};
export type DirectoryRequest = (path: string, options?: RequestInit) => Promise<DirectoryReply>;

export const directoryRequest: DirectoryRequest = async (path, options = {}) => {
  if (
    !/^(?:categories|(?:mine|admin)(?:\?page=[1-9]\d{0,2}(?:&status=archived)?)?|mine\/[A-Za-z0-9_-]{1,128}(?:\/(?:publish|archive|recover))?|review\/[A-Za-z0-9_-]{1,128})$/.test(
      path,
    )
  )
    throw new DirectoryRequestError("INVALID_DIRECTORY_INPUT", 400);
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
