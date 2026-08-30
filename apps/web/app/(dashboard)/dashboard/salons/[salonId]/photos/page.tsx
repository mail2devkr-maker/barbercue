"use client";

import { use, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_PATHS,
  PhotoType,
  Role,
  SALON_PHOTO_UPLOAD,
  createSalonPhotoSchema,
} from "@barbercue/shared";
import type { PhotoDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { RequireRole } from "../../../../../../components/auth/RequireRole";
import { SalonImage } from "../../../../../../components/ui/SalonImage";
import { Button } from "../../../../../../components/ui/Button";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

/** Which of the two routes to a photo the owner is using. Never both at once. */
type Source = "upload" | "link";

const MAX_MB = Math.floor(SALON_PHOTO_UPLOAD.maxBytes / (1024 * 1024));

/**
 * Owner photo management.
 *
 * Two ways in, one result: upload a file from the device (multipart → object storage → the
 * returned https URL) or paste a link to an image already hosted elsewhere. Both produce the same
 * Photo row, so nothing downstream — discovery cards, the profile hero — can tell them apart.
 *
 * The source is a deliberate either/or rather than two always-visible fields: only the chosen
 * one is rendered, so the browser can never demand a photo link while the owner is uploading a
 * file. Neither input carries `required`; the check lives in handleAdd, where it can say
 * something useful instead of "Please fill out this field".
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
  const [success, setSuccess] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [type, setType] = useState<PhotoType>(PhotoType.COVER);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // The preview is an object URL over the file already in memory — the image is never read into
  // a base64 data URL, which would copy the whole thing into a string a third larger again. The
  // browser only holds it until it is revoked, and every revoke goes through clearFile below or
  // this unmount cleanup, so navigating away never leaks the buffer.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearFile() {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    // Without this the input keeps the old selection, and re-picking the SAME file fires no
    // change event at all — the owner would click, choose, and see nothing happen.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    setSuccess(null);
    if (!chosen) {
      clearFile();
      return;
    }

    // Client-side checks are a courtesy — they save the owner a pointless upload and give an
    // instant answer. They are NOT the security boundary: file.type is whatever the OS guessed
    // from the extension, so the server re-decides by reading the file's magic bytes.
    const allowed = SALON_PHOTO_UPLOAD.allowedMimeTypes as readonly string[];
    if (!allowed.includes(chosen.type)) {
      clearFile();
      setError("That file isn’t a supported image. Please choose a JPG, PNG or WebP.");
      return;
    }
    if (chosen.size > SALON_PHOTO_UPLOAD.maxBytes) {
      clearFile();
      setError(`That photo is ${(chosen.size / (1024 * 1024)).toFixed(1)} MB. Please choose one under ${MAX_MB} MB.`);
      return;
    }

    setError(null);
    setFile(chosen);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(chosen);
    });
  }

  function switchSource(next: Source) {
    setSource(next);
    setError(null);
    setSuccess(null);
    // Whichever input is being left behind is emptied, so a stale value from the other route can
    // never be submitted by accident.
    if (next === "link") clearFile();
    else setUrl("");
  }

  function applyCreated(created: PhotoDto) {
    // A new cover demotes the previous one server-side; mirror that here so the list matches
    // without a refetch.
    setPhotos((prev) =>
      created.type === PhotoType.COVER
        ? [...(prev ?? []).map((p) => (p.type === PhotoType.COVER ? { ...p, type: PhotoType.GALLERY } : p)), created]
        : [...(prev ?? []), created],
    );
    setAltText("");
    setSuccess(created.type === PhotoType.COVER ? "Cover photo updated." : "Photo added to your gallery.");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    // Guard as well as the disabled button: a double-tap on a slow phone can land two submits
    // before React has re-rendered the button into its disabled state.
    if (submitting) return;
    setSuccess(null);

    if (source === "upload") {
      if (!file) {
        setError("Please choose a photo to upload.");
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const form = new FormData();
        form.append("image", file);
        if (altText.trim()) form.append("altText", altText.trim());
        form.append("type", type);
        // No Content-Type header — apiFetch deliberately leaves FormData alone so the browser can
        // set the multipart boundary itself.
        const created = await apiFetch<PhotoDto>(`${base}/${DASHBOARD_PATHS.photoUpload}`, {
          method: "POST",
          body: form,
        });
        applyCreated(created);
        clearFile();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not upload that photo. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

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
      applyCreated(created);
      setUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that photo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(photo: PhotoDto) {
    if (!window.confirm("Remove this photo from your shop? This only removes this photo record.")) return;
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`${base}/${photo.id}`, { method: "DELETE" });
      setPhotos((prev) => (prev ?? []).filter((p) => p.id !== photo.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that photo.");
    }
  }

  const cover = (photos ?? []).find((p) => p.type === PhotoType.COVER) ?? null;
  const externalPreview = source === "link" && createSalonPhotoSchema.safeParse({
    url: url.trim(), altText: altText.trim() || undefined, type,
  }).success ? url.trim() : null;

  return (
    <RequireRole roles={[Role.SALON_OWNER]} redirectTo="/dashboard/salons">
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Photos</h1>
      <p className={styles.pageSubtitle}>
        Your cover photo is what customers see first when they find you. Upload one straight from
        your phone or computer, or paste a direct HTTPS image URL. Photos are optional during setup.
      </p>
      <SetupNavigation salonId={salonId} currentStep="photos" section="steps" />

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {success && <p className={`${styles.banner} ${styles.bannerNotice}`}>{success}</p>}

      <section style={{ margin: "20px 0" }}>
        <h2 className={styles.sectionHeading} style={{ fontSize: 15 }}>Cover photo</h2>
        <div style={{ maxWidth: 360 }}>
          <SalonImage url={cover?.url ?? null} alt={cover?.altText ?? "Your shop's cover photo"} priority />
        </div>
      </section>

      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 14, margin: "20px 0 28px" }}>
        <div>
          <span className={styles.fieldLabel}>Add a photo</span>
          <div className={styles.toggleRow} role="group" aria-label="How to add a photo">
            <button
              type="button"
              onClick={() => switchSource("upload")}
              aria-pressed={source === "upload"}
              className={`${styles.toggle} ${source === "upload" ? styles.toggleActive : ""}`}
            >
              Upload photo
            </button>
            <button
              type="button"
              onClick={() => switchSource("link")}
              aria-pressed={source === "link"}
              className={`${styles.toggle} ${source === "link" ? styles.toggleActive : ""}`}
            >
              Paste photo link
            </button>
          </div>
        </div>

        {source === "upload" ? (
          <div>
            {/* The native input is the control — it is visually hidden rather than replaced, so
                the file picker, and the camera on a phone, behave exactly as the OS intends. */}
            <input
              ref={fileInputRef}
              id="photo-file"
              type="file"
              accept={SALON_PHOTO_UPLOAD.accept}
              onChange={handleFileChange}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            />
            <label
              htmlFor="photo-file"
              style={{
                display: "inline-block",
                padding: "11px 18px",
                minHeight: 44,
                background: "#fff",
                border: "1px solid var(--bc-ink)",
                borderRadius: "var(--bc-radius-sm)",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                boxSizing: "border-box",
                color: "var(--bc-ink)",
              }}
            >
              {file ? "Choose a different photo" : "+ Choose photo"}
            </label>
            <p className={styles.hint}>JPG, PNG or WebP, up to {MAX_MB} MB.</p>

            {file && previewUrl && (
              <div style={{ marginTop: 12 }}>
                <div style={{ maxWidth: 300 }}>
                  {/* priority (eager) rather than the default lazy load: this is the image the
                      owner just picked and is waiting to see, so deferring it until it scrolls
                      into view would leave the preview blank at exactly the wrong moment. */}
                  <SalonImage url={previewUrl} alt="Preview of the photo you selected" priority />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <span className={styles.hint} style={{ marginTop: 0, wordBreak: "break-all" }}>
                    {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  <Button type="button" variant="outline" onClick={clearFile}>
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className={styles.fieldLabel} htmlFor="photo-url">Photo link</label>
            <input
              id="photo-url"
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={styles.input}
            />
            <p className={styles.hint}>
              Use a direct HTTPS URL ending in an image response. Google Business or Instagram
              share-page links may block embedding and are not guaranteed to work.
            </p>
            {externalPreview && (
              <div style={{ maxWidth: 300, marginTop: 12 }}>
                <SalonImage url={externalPreview} alt="Preview of the direct image URL" priority />
              </div>
            )}
          </div>
        )}

        <div>
          <label className={styles.fieldLabel} htmlFor="photo-alt">Describe the photo (optional)</label>
          <input
            id="photo-alt"
            placeholder="Inside the shop"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            maxLength={200}
            className={styles.input}
          />
          <p className={styles.hint}>
            Helps customers using a screen reader, and helps you show up in search.
          </p>
        </div>
        <div>
          <label className={styles.fieldLabel} htmlFor="photo-type">Use as</label>
          <select
            id="photo-type"
            value={type}
            onChange={(e) => setType(e.target.value as PhotoType)}
            className={styles.select}
            style={{ maxWidth: 240 }}
          >
            <option value={PhotoType.COVER}>Cover photo</option>
            <option value={PhotoType.GALLERY}>Gallery photo</option>
          </select>
        </div>
        <div>
          <Button type="submit" variant="secondary" disabled={submitting}>
            {submitting ? (source === "upload" ? "Uploading…" : "Adding…") : "Add photo"}
          </Button>
        </div>
      </form>

      {photos === null && !error && <p className={styles.loadingText}>Loading…</p>}
      {photos?.length === 0 && (
        <p className={styles.emptyState}>No photos yet. Add your cover photo above.</p>
      )}
      {photos && photos.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
          {photos.map((p) => (
            <li key={p.id}>
              <SalonImage url={p.url} alt={p.altText ?? "Shop photo"} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span className={styles.rowMeta}>
                  {p.type === PhotoType.COVER ? "Cover" : "Gallery"}
                </span>
                <Button type="button" variant="outline" onClick={() => void handleRemove(p)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SetupNavigation salonId={salonId} currentStep="photos" section="actions" />
    </main>
    </RequireRole>
  );
}
