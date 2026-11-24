import type { BusinessMediaAsset } from "./business-media";

export const reelPartBytes = 768 * 1024;
export const reelMaxBytes = 32 * reelPartBytes;
export const reelMaxDuration = 90;
export const reelMinDuration = 1;
export const reelPosterEdge = 720;
export const reelBusinessLimit = 3;
export const reelAccountLimit = 12;
/** A published Reel is shown for at most this many hours, then its video and poster are deleted. */
export const reelLifetimeHours = 24;

export type ReelStatus =
  | "uploading"
  | "pending"
  | "published"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "removed";
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
  /** When a published Reel stops being shown (ISO UTC), otherwise null. */
  expiresAt: string | null;
};

/** Remaining time of a published Reel in Bosnian, e.g. "još 5 h" or "još 20 min". */
export function reelTimeLeft(expiresAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60000));
  if (!minutes) return "ističe sada";
  return minutes >= 60 ? `još ${Math.floor(minutes / 60)} h` : `još ${minutes} min`;
}
export function reelMedia(id: string, kind: "poster" | "video", preview = false) {
  return `/api/reels/media/${id}/${kind}${preview ? "?pregled=1" : ""}`;
}
export function reelDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function reelResubmissionNotice(admin: boolean) {
  if (admin) return "Vlasnik treba ponovo poslati reel.";
  // Reels can be sent from the web and from the Play edition alike.
  return "Povuci ovaj reel i pošalji ga ponovo.";
}
