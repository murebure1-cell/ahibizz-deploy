import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PublicBusinessView } from "../../lib/public-business";
import { Icon } from "../Icon";
import { useT } from "../i18n/LocaleProvider";
import styles from "./public-profile.module.css";

const thumbnailLimit = 4;

export function BusinessGallery({
  businessId,
  photos,
}: {
  businessId: string;
  photos: NonNullable<PublicBusinessView["gallery"]>;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const photo = index === null ? undefined : photos[index];
  const photoCount = photos.length;
  const more = photoCount - thumbnailLimit;

  useEffect(() => {
    function restore() {
      const saved = window.history.state?.ahiGallery;
      if (
        saved?.businessId === businessId &&
        Number.isInteger(saved.index) &&
        saved.index >= 0 &&
        saved.index < photoCount
      ) {
        setIndex(saved.index);
        if (!dialog.current?.open) dialog.current?.showModal();
      } else {
        dialog.current?.close();
        setIndex(null);
      }
    }
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [businessId, photoCount]);

  function show(next: number) {
    const state = { ...window.history.state, ahiGallery: { businessId, index: next } };
    if (dialog.current?.open) {
      window.history.replaceState(state, "");
    } else {
      window.history.pushState(state, "");
      dialog.current?.showModal();
    }
    setIndex(next);
  }

  function close() {
    if (!dialog.current?.open) return;
    dialog.current.close();
    setIndex(null);
    if (window.history.state?.ahiGallery?.businessId === businessId) window.history.back();
  }

  function step(direction: number) {
    if (index !== null && photos.length > 1) {
      show((index + direction + photos.length) % photos.length);
    }
  }

  return (
    <>
      <div className={styles.gallery}>
        {photos.slice(0, thumbnailLimit).map((item, position) => (
          <a
            className={styles.thumbnail}
            key={item.src}
            href={item.src}
            aria-haspopup="dialog"
            aria-label={t("Otvori fotografiju {number} od {total}", {
              number: position + 1,
              total: photos.length,
            })}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              show(position);
            }}
          >
            <Image
              src={item.src}
              alt={item.alt}
              fill
              sizes="(max-width: 760px) 45vw, 360px"
              unoptimized
            />
            {position === thumbnailLimit - 1 && more > 0 && (
              <span className={styles.morePhotos} aria-hidden="true">
                +{more}
              </span>
            )}
          </a>
        ))}
      </div>
      <dialog
        ref={dialog}
        className={styles.viewer}
        aria-label={t("Galerija fotografija")}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            step(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <header className={styles.viewerBar}>
          <span aria-live="polite">
            {index !== null &&
              t("Fotografija {number} od {total}", { number: index + 1, total: photos.length })}
          </span>
          <button type="button" onClick={close} aria-label={t("Zatvori galeriju")}>
            <Icon name="close" />
          </button>
        </header>
        {photo && (
          <div
            className={styles.viewerImage}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              touchStart.current =
                event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
            }}
            onTouchCancel={() => {
              touchStart.current = null;
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              touchStart.current = null;
              const end = event.changedTouches[0];
              if (!start || !end) return;
              const dx = end.clientX - start.x;
              if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(end.clientY - start.y) * 1.5)
                step(dx < 0 ? 1 : -1);
            }}
          >
            <Image
              key={photo.src}
              src={photo.src}
              alt={photo.alt}
              fill
              sizes="(max-width: 960px) 100vw, 960px"
              loading="eager"
              unoptimized
            />
          </div>
        )}
        {photos.length > 1 && (
          <div className={styles.viewerControls}>
            <button type="button" aria-label={t("Prethodna fotografija")} onClick={() => step(-1)}>
              <Icon name="chevron" />
            </button>
            <button type="button" aria-label={t("Sljedeća fotografija")} onClick={() => step(1)}>
              <Icon name="chevron" />
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
