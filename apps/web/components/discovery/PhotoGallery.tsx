"use client";

import { useEffect, useRef, useState } from "react";
import type { PhotoDto } from "@barbercue/shared";
import styles from "./discovery-content.module.css";

// Plain <img>, not next/image or SalonImage: this grid's layout (the first-photo-spans-2-rows
// CSS trick in .photoGrid, sized via grid-auto-rows) depends on <img> being a direct grid child —
// swapping in SalonImage's own wrapper <div> breaks both that layout and the fixed row sizing (see
// PhotoGallery's git history for the attempt and why it was reverted). Instead, each photo tracks
// its own load-failure state directly, degrading to the same honest "photo unavailable" tile
// SalonImage uses elsewhere, without changing the grid's DOM shape. No object-storage/CDN is wired
// yet (DEPLOYMENT.md defers this), so there's no remote-pattern host to configure in
// next.config.ts — not solved here. The seeded demo salon has zero Photo rows today, so the empty
// state below is the common case right now, not a hypothetical.
function GalleryPhoto({
  photo,
  salonName,
  onOpen,
}: {
  photo: PhotoDto;
  salonName: string;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={styles.photoUnavailable} role="img" aria-label={photo.altText ?? salonName}>
        Photo unavailable
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see file header comment
    <img
      src={photo.url}
      alt={photo.altText ?? salonName}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      onClick={onOpen}
      className={styles.photoThumb}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    />
  );
}

// Full-size view for the photo at `openIndex`. Kept as a sibling overlay (not wrapping the grid
// thumbnails) so the grid's direct-child CSS dependency above is untouched. Only ever mounted for
// photos that already loaded as a thumbnail — a photo that failed to load as a thumbnail has no
// "view larger" affordance, since a bigger broken image would be a worse failure, not a better one.
function Lightbox({
  photos,
  salonName,
  openIndex,
  setOpenIndex,
}: {
  photos: PhotoDto[];
  salonName: string;
  openIndex: number;
  setOpenIndex: (i: number | null) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const photo = photos[openIndex];

  useEffect(() => {
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
      else if (e.key === "ArrowRight") setOpenIndex((openIndex + 1) % photos.length);
      else if (e.key === "ArrowLeft") setOpenIndex((openIndex - 1 + photos.length) % photos.length);
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpenIndex prop identity is stable across renders (useState setter)
  }, [openIndex, photos.length]);

  return (
    <div
      className={styles.lightboxBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${photo.altText ?? salonName} — photo ${openIndex + 1} of ${photos.length}`}
      onClick={() => setOpenIndex(null)}
    >
      <button
        ref={closeButtonRef}
        type="button"
        className={styles.lightboxClose}
        aria-label="Close photo viewer"
        onClick={() => setOpenIndex(null)}
      >
        &times;
      </button>
      {photos.length > 1 && (
        <button
          type="button"
          className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            setOpenIndex((openIndex - 1 + photos.length) % photos.length);
          }}
        >
          &#8249;
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- lightbox view of an already-loaded thumbnail, not an optimizable route asset */}
      <img
        src={photo.url}
        alt={photo.altText ?? salonName}
        className={styles.lightboxImage}
        onClick={(e) => e.stopPropagation()}
      />
      {photos.length > 1 && (
        <button
          type="button"
          className={`${styles.lightboxNav} ${styles.lightboxNext}`}
          aria-label="Next photo"
          onClick={(e) => {
            e.stopPropagation();
            setOpenIndex((openIndex + 1) % photos.length);
          }}
        >
          &#8250;
        </button>
      )}
      {photos.length > 1 && (
        <p className={styles.lightboxCounter}>
          {openIndex + 1} / {photos.length}
        </p>
      )}
    </div>
  );
}

export function PhotoGallery({ photos, salonName }: { photos: PhotoDto[]; salonName: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (photos.length === 0) {
    // "Coming soon" implies a feature that doesn't exist yet — owner photo upload is live, this
    // shop simply hasn't added one, same honest framing the owner-side empty state already uses.
    return <div className={styles.empty}>This shop has not added photos yet.</div>;
  }
  return (
    <>
      <div className={styles.photoGrid}>
        {photos.map((p, i) => (
          <GalleryPhoto key={p.id} photo={p} salonName={salonName} onOpen={() => setOpenIndex(i)} />
        ))}
      </div>
      {openIndex !== null && (
        <Lightbox photos={photos} salonName={salonName} openIndex={openIndex} setOpenIndex={setOpenIndex} />
      )}
    </>
  );
}
