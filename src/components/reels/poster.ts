import { reelPartBytes } from "../../lib/reels";

export async function previewFrame(file: File): Promise<Blob | null> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    return await new Promise<Blob | null>((resolve) => {
      let seeking = false;
      const deadline = window.setTimeout(() => resolve(null), 7000);
      const finish = (blob: Blob | null) => {
        window.clearTimeout(deadline);
        resolve(blob && blob.size <= reelPartBytes ? blob : null);
      };
      video.onerror = () => finish(null);
      video.onloadedmetadata = () => {
        if (seeking) return;
        seeking = true;
        if (!Number.isFinite(video.duration) || !video.videoWidth || !video.videoHeight)
          return finish(null);
        video.currentTime = Math.min(0.7, video.duration / 2);
      };
      video.onseeked = () => {
        if (video.readyState < 2) return finish(null);
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 540 / video.videoWidth, 960 / video.videoHeight);
        canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
        try {
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(finish, "image/jpeg", 0.8);
        } catch {
          finish(null);
        }
      };
      video.src = url;
    });
  } finally {
    video.onloadedmetadata = null;
    video.onseeked = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
