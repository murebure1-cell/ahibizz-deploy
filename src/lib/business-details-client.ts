import type { DirectoryBusiness } from "../server/directory/types";
import { readBusinessDetails } from "./business-details";
import { DirectoryRequestError } from "./directory-create-submission";

export type BusinessDetailsRequest = (
  id: string,
  accountId: string,
  options?: RequestInit,
) => Promise<DirectoryBusiness>;
export const businessDetailsRequest: BusinessDetailsRequest = async (
  id,
  accountId,
  options = {},
) => {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)
  )
    throw new DirectoryRequestError("ACCOUNT_IDENTITY_CHANGED", 401);
  const headers = new Headers(options.headers);
  headers.set("X-AhiBizz-Account-ID", accountId);
  const response = await fetch(`/api/business-details/mine/${id}`, {
    ...options,
    headers,
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new DirectoryRequestError(
      typeof data?.code === "string" ? data.code : "DIRECTORY_UNAVAILABLE",
      response.status,
    );
  const business = data?.business;
  if (
    !business ||
    business.id !== id ||
    !Number.isInteger(business.version) ||
    business.version < 1 ||
    !["draft", "pending", "published", "archived"].includes(business.status)
  )
    throw new DirectoryRequestError("DIRECTORY_UNAVAILABLE");
  if (business.details != null) readBusinessDetails(business.details);
  return business;
};
