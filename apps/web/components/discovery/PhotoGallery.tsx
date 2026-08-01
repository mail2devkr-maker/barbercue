import type { PhotoDto } from "@barbercue/shared";

// Plain <img>, not next/image: no object-storage/CDN is wired yet (DEPLOYMENT.md defers this),
// so there's no remote-pattern host to configure in next.config.ts. Switch once that's decided —
// not solved here. The seeded demo salon has zero Photo rows today, so the empty state below is
// the common case right now, not a hypothetical.
export function PhotoGallery({ photos, salonName }: { photos: PhotoDto[]; salonName: string }) {
  if (photos.length === 0) {
    return (
      <div
        style={{
          background: "#F6F2EA",
          border: "1px dashed #E7E0D3",
          borderRadius: 12,
          padding: 32,
          textAlign: "center",
          color: "#6B6357",
        }}
      >
        Photos coming soon.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
      {photos.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- see file header comment
        <img
          key={p.id}
          src={p.url}
          alt={p.altText ?? salonName}
          style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8 }}
        />
      ))}
    </div>
  );
}
