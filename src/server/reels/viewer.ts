import { headers } from "next/headers";
import { cache } from "react";
import { getSearchBlockViewer } from "../account-blocks";

export const currentReelViewer = cache(async () =>
  getSearchBlockViewer(await headers()).catch(() => null),
);
