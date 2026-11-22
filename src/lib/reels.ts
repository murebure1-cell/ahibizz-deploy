import type { BusinessMediaAsset } from "./business-media";

export const reelPartBytes = 768 * 1024;
export const reelMaxBytes = 32 * reelPartBytes;
export const reelMaxDuration = 90;
export const reelMinDuration = 1;
export const reelPosterEdge = 720;
export const reelBusinessLimit = 3;
export const reelAccountLimit = 12;

export type ReelStatus = "uploading" | "pending" | "published" | "rejected" | "withdrawn";
export type PublicReel = {
  id: string;
  businessId: string;
  businessTitle: string;
  businessLogo: BusinessMediaAsset | null;
  city: string | null;
  title: string;
  caption: string;
  durationMs: number;
  hasPoster: boolean;
  publishedAt: string | null;
};
export type ReelFeedPage = { items: PublicReel[]; next: string | null };
export type ReelEngagement = {
  likes: number;
  views: number;
  liked: boolean;
  canLike: boolean;
  accountId: string | null;
};
export type ManagedReel = Omit<PublicReel, "durationMs" | "businessLogo"> & {
  status: ReelStatus;
  durationMs: number | null;
  reviewReason: string | null;
  createdAt: string;
};
export function reelMedia(id: string, kind: "poster" | "video", preview = false) {
  return `/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}`;
}
export function reelDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function reelResubmissionNotice(admin: boolean, _playEdition: boolean) {
  return admin ? "Vlasnik treba ponovo poslati reel." : "Povuci ovaj reel i po?alji ga ponovo.";
}
