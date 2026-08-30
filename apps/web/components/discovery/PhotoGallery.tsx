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
//
// `failed` is owned by the parent (PhotoGallery), not local state here, so the lightbox can skip
// over a photo whose thumbnail is already known broken instead of blindly navigating into it.
function GalleryPhoto({
  photo,
  salonName,
  failed,
  onFail,
  onOpen,
}: {
  photo: PhotoDto;
  salonName: string;
  failed: boolean;
  onFail: () => void;
  onOpen: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
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
      onError={onFail}
      onClick={onOpen}
      className={styles.photoThumb}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e);
        }
      }}
    />
  );
}

// Full-size view for the photo at `openIndex`. Kept as a sibling overlay (not wrapping the grid
// thumbnails) so the grid's direct-child CSS dependency above is untouched. Only ever opened from
// a thumbnail that already loaded — a photo that failed to load as a thumbnail has no "view
// larger" affordance, since a bigger broken image would be a worse failure, not a better one.
// `failedIndices` also covers a photo whose full-size load fails INSIDE the lightbox even though
// its thumbnail succeeded (a flakier/larger asset, or a URL that broke between the two loads):
// navigation skips those the same way, and the whole viewer closes if every photo ends up failed.
function Lightbox({
  photos,
  salonName,
  openIndex,
  setOpenIndex,
  failedIndices,
  markFailed,
  openerRef,
}: {
  photos: PhotoDto[];
  salonName: string;
  openIndex: number;
  setOpenIndex: (i: number | null) => void;
  failedIndices: Set<number>;
  markFailed: (i: number) => void;
  // A ref, not a resolved element: reading .current has to happen in an effect/handler, never
  // during render (React flags render-time ref reads as a bug, since they can't be relied on to
  // trigger a re-render or reflect the latest value consistently).
  openerRef: React.RefObject<HTMLElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const prevButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const photo = photos[openIndex];

  function step(direction: 1 | -1) {
    for (let i = 1; i <= photos.length; i++) {
      const candidate = (openIndex + direction * i + photos.length) % photos.length;
      if (!failedIndices.has(candidate)) {
        setOpenIndex(candidate);
        return;
      }
    }
    // Every photo is now known-failed — nothing left to show.
    setOpenIndex(null);
  }

  useEffect(() => {
    closeButtonRef.current?.focus();
    function focusableElements(): HTMLElement[] {
      return [prevButtonRef.current, closeButtonRef.current, nextButtonRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenIndex(null);
        return;
      }
      if (e.key === "ArrowRight") {
        step(1);
        return;
      }
      if (e.key === "ArrowLeft") {
        step(-1);
        return;
      }
      if (e.key === "Tab") {
        // Trap focus inside the dialog: only the (up to three) buttons are ever focusable here,
        // since the image itself isn't a tab stop. Wrap around at either end instead of letting
        // Tab/Shift+Tab escape to whatever the page's own next/previous focusable element is.
        const focusable = focusableElements();
        if (focusable.length === 0) return;
        const currentIdx = focusable.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        const delta = e.shiftKey ? -1 : 1;
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + delta + focusable.length) % focusable.length;
        focusable[nextIdx]?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpenIndex/markFailed prop identity is stable across renders (useState setter / useCallback-free closures over stable refs)
  }, [openIndex, photos.length, failedIndices]);

  // Focus never left the dialog while it was open (see the Tab trap above), so returning it to
  // whichever thumbnail/opener triggered the lightbox is exactly "restore what Tab order was
  // already at" rather than a guess.
  useEffect(() => {
    const opener = openerRef.current;
    return () => {
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openerRef is a stable ref object; runs only on unmount
  }, []);

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
          ref={prevButtonRef}
          type="button"
          className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
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
        onError={() => {
          // Compute the post-failure set inline rather than calling step(1) (which reads
          // failedIndices from this render's closure, not yet updated by markFailed's async state
          // set) — that distinction matters specifically when this is the last surviving photo:
          // step(1) would still see it as "not failed" and re-select it, looping on the same
          // broken image forever instead of correctly closing.
          markFailed(openIndex);
          const updated = new Set(failedIndices).add(openIndex);
          let next: number | null = null;
          for (let i = 1; i <= photos.length; i++) {
            const candidate = (openIndex + i) % photos.length;
            if (!updated.has(candidate)) {
              next = candidate;
              break;
            }
          }
          setOpenIndex(next);
        }}
      />
      {photos.length > 1 && (
        <button
          ref={nextButtonRef}
          type="button"
          className={`${styles.lightboxNav} ${styles.lightboxNext}`}
          aria-label="Next photo"
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
        >
          &#8250;
        </button>
      )}
      {photos.length > 1 && (
        <p className={styles.lightboxCounter} aria-live="polite">
          {openIndex + 1} / {photos.length}
        </p>
      )}
    </div>
  );
}

export function PhotoGallery({ photos, salonName }: { photos: PhotoDto[]; salonName: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [failedIndices, setFailedIndices] = useState<Set<number>>(new Set());
  const openerRef = useRef<HTMLElement | null>(null);

  function markFailed(index: number) {
    setFailedIndices((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }

  if (photos.length === 0) {
    // "Coming soon" implies a feature that doesn't exist yet — owner photo upload is live, this
    // shop simply hasn't added one, same honest framing the owner-side empty state already uses.
    return <div className={styles.empty}>This shop has not added photos yet.</div>;
  }
  return (
    <>
      <div className={styles.photoGrid}>
        {photos.map((p, i) => (
          <GalleryPhoto
            key={p.id}
            photo={p}
            salonName={salonName}
            failed={failedIndices.has(i)}
            onFail={() => markFailed(i)}
            onOpen={(e) => {
              openerRef.current = e.currentTarget as HTMLElement;
              setOpenIndex(i);
            }}
          />
        ))}
      </div>
      {openIndex !== null && (
        <Lightbox
          photos={photos}
          salonName={salonName}
          openIndex={openIndex}
          setOpenIndex={setOpenIndex}
          failedIndices={failedIndices}
          markFailed={markFailed}
          openerRef={openerRef}
        />
      )}
    </>
  );
}
