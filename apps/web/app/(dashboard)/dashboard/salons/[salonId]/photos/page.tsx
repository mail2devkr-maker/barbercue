"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, PhotoType, createSalonPhotoSchema } from "@barbercue/shared";
import type { PhotoDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { SalonImage } from "../../../../../../components/ui/SalonImage";

/**
 * Owner photo management. Photos are linked by URL rather than uploaded — no object storage is
 * configured for this deployment — so the copy tells the owner plainly where a link can come from
 * instead of showing an upload control that cannot work.
 */
export default function DashboardPhotosPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.photos}`;

  const [photos, setPhotos] = useState<PhotoDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [type, setType] = useState<PhotoType>(PhotoType.COVER);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PhotoDto[]>(base)
      .then((list) => {
        if (!cancelled) setPhotos(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your photos.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createSalonPhotoSchema.safeParse({
      url: url.trim(),
      altText: altText.trim() || undefined,
      type,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the photo link.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<PhotoDto>(base, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      // A new cover demotes the previous one server-side; mirror that here so the list matches
      // without a refetch.
      setPhotos((prev) =>
        created.type === PhotoType.COVER
          ? [...(prev ?? []).map((p) => (p.type === PhotoType.COVER ? { ...p, type: PhotoType.GALLERY } : p)), created]
          : [...(prev ?? []), created],
      );
      setUrl("");
      setAltText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that photo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(photo: PhotoDto) {
    setError(null);
    try {
      await apiFetch(`${base}/${photo.id}`, { method: "DELETE" });
      setPhotos((prev) => (prev ?? []).filter((p) => p.id !== photo.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that photo.");
    }
  }

  const cover = (photos ?? []).find((p) => p.type === PhotoType.COVER) ?? null;

  return (
    <main style={{ padding: "2rem 1.25rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <Link href={`/dashboard/salons/${salonId}/settings`} style={{ fontSize: 14 }}>
        ← Back to shop setup
      </Link>
      <h1 style={{ marginTop: 12 }}>Photos</h1>
      <p style={{ color: "#6B6357" }}>
        Your cover photo is what customers see first when they find you. Paste a link to a photo
        you already have online — your Google Business profile or Instagram both work.
      </p>

      {error && <p style={errorStyle}>{error}</p>}

      <section style={{ margin: "20px 0" }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Cover photo</h2>
        <div style={{ maxWidth: 360 }}>
          <SalonImage url={cover?.url ?? null} alt={cover?.altText ?? "Your shop's cover photo"} priority />
        </div>
      </section>

      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 12, margin: "20px 0 28px" }}>
        <div>
          <label style={labelStyle} htmlFor="photo-url">Photo link</label>
          <input
            id="photo-url"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="photo-alt">Describe the photo (optional)</label>
          <input
            id="photo-alt"
            placeholder="Inside the shop"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            maxLength={200}
            style={inputStyle}
          />
          <p style={{ fontSize: 13, color: "#6B6357", marginTop: 6 }}>
            Helps customers using a screen reader, and helps you show up in search.
          </p>
        </div>
        <div>
          <label style={labelStyle} htmlFor="photo-type">Use as</label>
          <select
            id="photo-type"
            value={type}
            onChange={(e) => setType(e.target.value as PhotoType)}
            style={{ ...inputStyle, maxWidth: 240 }}
          >
            <option value={PhotoType.COVER}>Cover photo</option>
            <option value={PhotoType.GALLERY}>Gallery photo</option>
          </select>
        </div>
        <button type="submit" disabled={submitting} style={buttonStyle}>
          {submitting ? "Adding…" : "Add photo"}
        </button>
      </form>

      {photos === null && <p>Loading…</p>}
      {photos?.length === 0 && (
        <p style={{ color: "#6B6357" }}>No photos yet. Add your cover photo above.</p>
      )}
      {photos && photos.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
          {photos.map((p) => (
            <li key={p.id}>
              <SalonImage url={p.url} alt={p.altText ?? "Shop photo"} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 13, color: "#6B6357" }}>
                  {p.type === PhotoType.COVER ? "Cover" : "Gallery"}
                </span>
                <button type="button" onClick={() => void handleRemove(p)} style={secondaryButtonStyle}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: "1px solid #E7E0D3",
  // 16px minimum: anything smaller makes iOS Safari zoom the page on focus.
  fontSize: 16,
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 5,
  fontWeight: 600,
  fontSize: 13,
};
const buttonStyle: React.CSSProperties = {
  padding: "12px 20px",
  minHeight: 46,
  background: "#1C1A17",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
  alignSelf: "flex-start",
};
const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  minHeight: 38,
  background: "#fff",
  border: "1px solid #E7E0D3",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 13,
};
const errorStyle: React.CSSProperties = {
  background: "#FBEAEA",
  color: "#B0413E",
  padding: "10px 14px",
  borderRadius: 8,
};
