import type { PhotoDto } from "@barbercue/shared";

// Plain <img>, not next/image: no object-storage/CDN is wired yet (DEPLOYMENT.md defers this),
// so there's no remote-pattern host to configure in next.config.ts. Switch once that's decided —
// not solved here. The seeded demo salon has zero Photo rows today, so the empty state below is
// the common case right now, not a hypothetical.
export function PhotoGallery({ photos, salonName }: { photos: PhotoDto[]; salonName: string }) {
  if (photos.length === 0) {
    // "Coming soon" implies a feature that doesn't exist yet — owner photo upload is live, this
    // shop simply hasn't added one, same honest framing the owner-side empty state already uses.
    return (
      <div
        style={{
          background: "var(--bc-surface)",
          border: "1px dashed var(--bc-border)",
          borderRadius: "var(--bc-radius-md)",
          padding: 32,
          textAlign: "center",
          color: "var(--bc-muted)",
        }}
      >
        No photos yet.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
      {photos.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- see file header comment
        <img
          key={p.id}
          src={p.url}
          alt={p.altText ?? salonName}
          style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: "var(--bc-radius-sm)" }}
        />
      ))}
    </div>
  );
}
