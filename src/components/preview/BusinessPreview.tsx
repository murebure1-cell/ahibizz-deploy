"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { bookingWrite } from "../../lib/booking-client";
import { publicBusinessImages } from "../../lib/public-business";
import { BusinessBookingManager } from "../booking/BusinessBookingManager";
import {
  BusinessEditor,
  type BusinessFields,
  type CategoryOption,
} from "../directory/BusinessEditor";
import { BusinessMediaManager } from "../directory/BusinessMediaManager";
import { PublicBusinessProfile } from "../directory/PublicBusinessProfile";
import { Icon } from "../Icon";
import { useBookingPreview } from "./BookingPreviewState";
import { type BusinessPreviewDraft, useBusinessPreview } from "./BusinessPreviewState";
import styles from "./business-preview.module.css";
import { PreviewBooking } from "./PreviewBooking";

// Design choices only. These IDs are never sent to the real directory service.
const categories: CategoryOption[] = [
  { id: "preview-health", name: "Ljepota i zdravlje", parentId: null },
  { id: "preview-massage", name: "Masaže i njega", parentId: "preview-health" },
  { id: "preview-physio", name: "Fizioterapija", parentId: "preview-health" },
  { id: "preview-home", name: "Dom i uređenje", parentId: null },
  { id: "preview-interior", name: "Uređenje prostora", parentId: "preview-home" },
  { id: "preview-furniture", name: "Namještaj", parentId: "preview-home" },
  { id: "preview-food", name: "Hrana i piće", parentId: null },
  { id: "preview-cafe", name: "Kafići", parentId: "preview-food" },
  { id: "preview-restaurant", name: "Restorani", parentId: "preview-food" },
  { id: "preview-services", name: "Servisi i usluge", parentId: null },
  { id: "preview-moving", name: "Selidbe i prijevoz", parentId: "preview-services" },
  { id: "preview-repairs", name: "Popravke i održavanje", parentId: "preview-services" },
];

type Draft = BusinessPreviewDraft;

export function BusinessPreview() {
  const booking = useBookingPreview();
  const store = useBusinessPreview(),
    media = store.media,
    drafts = store.getDrafts(),
    setDrafts = store.setDrafts;
  const [editing, setEditing] = useState<Draft | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [note, setNote] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingIntent = useRef(false);
  const visible = drafts.filter((draft) => showArchived || !draft.archived);
  const hasArchived = drafts.some((draft) => draft.archived);
  const profile = drafts.find((draft) => draft.id === profileId);
  if (mediaId)
    return (
      <BusinessMediaManager
        key={mediaId}
        businessId={mediaId}
        businessTitle={drafts.find((d) => d.id === mediaId)?.title ?? "Djelatnost"}
        preview
        request={media.request}
        imageUrl={(id, asset) => media.imageUrl(id, asset)}
        onBack={() => setMediaId(null)}
      />
    );
  if (bookingId)
    return (
      <BusinessBookingManager
        businessId={bookingId}
        businessTitle={
          drafts.find((draft) => draft.id === bookingId)?.title ?? "Studio Forma · ogledni profil"
        }
        preview
        request={booking.ownerRequest}
        onBack={() => setBookingId(null)}
      />
    );
  if (profile)
    return (
      <div className={styles.workspace}>
        <button type="button" className={styles.back} onClick={() => setProfileId(null)}>
          Nazad na moje djelatnosti
        </button>
        <PublicBusinessProfile
          backHref={null}
          preview
          business={{
            ...profile,
            categoryName: categories.find((item) => item.id === profile.categoryId)?.name ?? null,
            subcategoryName:
              categories.find((item) => item.id === profile.subcategoryId)?.name ?? null,
            verified: false,
            ...publicBusinessImages(profile.id, media.getManifest(profile.id), (id, asset) =>
              media.imageUrl(id, asset),
            ),
          }}
        >
          {booking.getConfig(profile.id).enabled &&
          booking.getConfig(profile.id).services.length > 0 ? (
            <PreviewBooking businessId={profile.id} />
          ) : null}
        </PublicBusinessProfile>
      </div>
    );

  async function save(fields: BusinessFields) {
    if (editing === null || savingIntent.current) return;
    savingIntent.current = true;
    setSaving(true);
    try {
      let targetId: string;
      if (editing === "new") {
        const id = crypto.randomUUID();
        targetId = id;
        booking.registerBusiness(id, fields.title);
        setDrafts((previous) => [...previous, { ...fields, id, archived: false, version: 1 }]);
      } else {
        const id = editing.id;
        targetId = id;
        booking.registerBusiness(id, fields.title);
        setDrafts((previous) =>
          previous.map((draft) =>
            draft.id === id ? { ...draft, ...fields, version: draft.version + 1 } : draft,
          ),
        );
      }
      if (typeof fields.bookingEnabled === "boolean") {
        const { settings } = await booking.ownerRequest(`mine/businesses/${targetId}/settings`);
        if (settings.enabled !== fields.bookingEnabled)
          await booking.ownerRequest(
            `mine/businesses/${targetId}/settings`,
            bookingWrite("PATCH", {
              enabled: fields.bookingEnabled,
              timezone: settings.timezone,
              expectedVersion: settings.version,
              windows: settings.windows,
              services: settings.services,
            }),
          );
        if (fields.bookingEnabled) setBookingId(targetId);
      }
      setEditing(null);
      setNote("Nacrt je sačuvan u pregledu.");
    } catch {
      setEditing(null);
      setNote("Nacrt je sačuvan. Provjeri booking u kalendaru.");
    } finally {
      savingIntent.current = false;
      setSaving(false);
    }
  }

  function archive(draft: Draft) {
    setDrafts((previous) =>
      previous.map((item) =>
        item.id === draft.id
          ? { ...item, archived: !item.archived, version: item.version + 1 }
          : item,
      ),
    );
    setNote(draft.archived ? "Probni nacrt je vraćen u pregled." : "Probni nacrt je arhiviran.");
  }

  return (
    <div className={styles.workspace}>
      <p className={styles.previewNote}>Probni nacrti se ne objavljuju i nestaju osvježavanjem.</p>
      <p className={styles.feedback} role="status">
        {note}
      </p>

      {editing !== null ? (
        <div className={styles.editorWrap}>
          <BusinessEditor
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            categories={categories}
            busy={saving}
            preview
            canPublish={false}
            bookingEnabled={editing === "new" ? false : booking.getSettings(editing.id).enabled}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <button className={styles.edit} type="button" onClick={() => setBookingId("forma")}>
              Isprobaj booking Studija Forma
            </button>
            <button
              className={styles.primary}
              type="button"
              onClick={() => {
                setNote("");
                setEditing("new");
              }}
            >
              <Icon name="shop" /> Dodaj u pregled
            </button>
            {hasArchived && (
              <label className={styles.archiveToggle}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                Prikaži arhivirane
              </label>
            )}
          </div>

          {visible.length ? (
            <div className={styles.list}>
              {visible.map((draft) => {
                const category = categories.find((item) => item.id === draft.categoryId)?.name;
                const subcategory = categories.find(
                  (item) => item.id === draft.subcategoryId,
                )?.name;
                const logo = media.getManifest(draft.id).logo;
                const logoUrl = logo ? media.imageUrl(draft.id, logo) : null;
                return (
                  <article className={styles.business} key={draft.id}>
                    <div className={styles.businessBody}>
                      <span className={styles.monogram} aria-hidden="true">
                        {logoUrl ? (
                          <Image src={logoUrl} alt="" width={46} height={46} unoptimized />
                        ) : (
                          Array.from(draft.title)[0]?.toLocaleUpperCase("bs") || "D"
                        )}
                      </span>
                      <div className={styles.identity}>
                        <h3>{draft.title}</h3>
                        <p>{[category, subcategory].filter(Boolean).join(" · ")}</p>
                        {draft.city && (
                          <span className={styles.city}>
                            <Icon name="pin" />
                            {draft.city}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.businessFooter}>
                      <span className={styles.draftState}>
                        {draft.archived
                          ? "Arhivirano u pregledu"
                          : "Ogledni nacrt · nije objavljen"}
                      </span>
                      <div className={styles.actions}>
                        {!draft.archived && (
                          <button
                            type="button"
                            className={styles.edit}
                            onClick={() => setMediaId(draft.id)}
                          >
                            Fotografije
                          </button>
                        )}
                        {!draft.archived && (
                          <button
                            type="button"
                            className={styles.edit}
                            onClick={() => setBookingId(draft.id)}
                          >
                            Booking
                          </button>
                        )}
                        {!draft.archived && (
                          <button
                            type="button"
                            className={styles.edit}
                            onClick={() => setProfileId(draft.id)}
                            aria-label={`Prikaži ${draft.title}`}
                          >
                            Prikaži profil
                          </button>
                        )}
                        {!draft.archived && (
                          <button
                            type="button"
                            className={styles.edit}
                            onClick={() => {
                              setNote("");
                              setEditing({
                                ...draft,
                                bookingEnabled: booking.getSettings(draft.id).enabled,
                              });
                            }}
                            aria-label={`Uredi ${draft.title}`}
                          >
                            Uredi <Icon name="arrow" />
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.archive}
                          onClick={() => archive(draft)}
                          aria-label={`${draft.archived ? "Vrati" : "Arhiviraj"} ${draft.title}`}
                        >
                          {draft.archived ? "Vrati nacrt" : "Arhiviraj"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <span>
                <Icon name="shop" />
              </span>
              <h3>
                {drafts.length ? "Nema aktivnih probnih nacrta." : "Isprobaj unos djelatnosti."}
              </h3>
              <p>
                {drafts.length
                  ? "Uključi prikaz arhiviranih nacrta da ih vidiš."
                  : "Dodaj naziv, kategoriju i osnovne podatke. Sve ostaje u ovom pregledu."}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
