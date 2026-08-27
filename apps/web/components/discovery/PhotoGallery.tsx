import type { PhotoDto } from "@barbercue/shared";
import styles from "./discovery-content.module.css";

// Plain <img>, not next/image: no object-storage/CDN is wired yet (DEPLOYMENT.md defers this),
// so there's no remote-pattern host to configure in next.config.ts. Switch once that's decided —
// not solved here. The seeded demo salon has zero Photo rows today, so the empty state below is
// the common case right now, not a hypothetical.
export function PhotoGallery({ photos, salonName }: { photos: PhotoDto[]; salonName: string }) {
  if (photos.length === 0) {
    // "Coming soon" implies a feature that doesn't exist yet — owner photo upload is live, this
    // shop simply hasn't added one, same honest framing the owner-side empty state already uses.
    return <div className={styles.empty}>This shop has not added photos yet.</div>;
  }
  return (
    <div className={styles.photoGrid}>
      {photos.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- see file header comment
        <img
          key={p.id}
          src={p.url}
          alt={p.altText ?? salonName}
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
}
