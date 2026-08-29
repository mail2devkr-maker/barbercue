"use client";

import { useState } from "react";
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
function GalleryPhoto({ photo, salonName }: { photo: PhotoDto; salonName: string }) {
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
    />
  );
}

export function PhotoGallery({ photos, salonName }: { photos: PhotoDto[]; salonName: string }) {
  if (photos.length === 0) {
    // "Coming soon" implies a feature that doesn't exist yet — owner photo upload is live, this
    // shop simply hasn't added one, same honest framing the owner-side empty state already uses.
    return <div className={styles.empty}>This shop has not added photos yet.</div>;
  }
  return (
    <div className={styles.photoGrid}>
      {photos.map((p) => (
        <GalleryPhoto key={p.id} photo={p} salonName={salonName} />
      ))}
    </div>
  );
}
