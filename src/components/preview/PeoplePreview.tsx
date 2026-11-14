"use client";
import { messageLink } from "../../lib/messaging";
import styles from "../connections/connections.module.css";
import { PeopleSearch } from "../connections/PeopleSearch";
import { PublicPersonProfile } from "../connections/PublicPersonProfile";
import { useConnectionsPreview } from "./ConnectionsPreviewState";
export function PeoplePreview({ personId }: { personId?: string }) {
  const api = useConnectionsPreview();
  return (
    <main
      id="glavni-sadrzaj"
      className={`preview-container ${personId ? styles.personPage : styles.peoplePage}`}
    >
      {personId ? (
        <PublicPersonProfile
          key={personId}
          personId={personId}
          preview
          request={api.request}
          imageUrl={api.imageUrl}
          ownProfileHref="/pregled/prostor/nalog?odjeljak=profil"
          messageHref={messageLink({ kind: "person", targetId: personId }, true)}
        />
      ) : (
        <PeopleSearch
          preview
          request={api.request}
          imageUrl={api.imageUrl}
          profileHref={(id) => `/pregled/ljudi?profil=${encodeURIComponent(id)}`}
        />
      )}
    </main>
  );
}
