"use client";
import { PublicBusinessProfile } from "../../../components/directory/PublicBusinessProfile";
import styles from "../../../components/directory/public-profile.module.css";
import { Icon } from "../../../components/Icon";
import type { PreviewBusiness } from "../../../components/preview/data";
import { PreviewBooking } from "../../../components/preview/PreviewBooking";
import { usePreviewState } from "../../../components/preview/PreviewState";
import { previewPublicBusiness } from "../../../components/preview/public-view";
import { messageLink } from "../../../lib/messaging";

export function ProfilePreview({ business }: { business: PreviewBusiness }) {
  const state = usePreviewState(),
    saved = state.saved.has(business.id);
  return (
    <main id="glavni-sadrzaj">
      <PublicBusinessProfile
        business={previewPublicBusiness(business)}
        backHref="/pregled/pretraga"
        preview
        messageHref={messageLink({ kind: "business", targetId: business.id }, true)}
        actions={
          <button
            className={styles.secondary}
            type="button"
            aria-pressed={saved}
            onClick={() => state.toggleSaved(business.id)}
          >
            <Icon name="heart" fill={saved ? "currentColor" : "none"} />
            {saved ? "Sačuvano u pregledu" : "Sačuvaj u pregledu"}
          </button>
        }
      >
        {business.id === "forma" ? <PreviewBooking /> : null}
      </PublicBusinessProfile>
    </main>
  );
}
