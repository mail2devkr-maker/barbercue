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

/** Which of the two routes to the cover photo the owner is using. Never both at once. */
type CoverSource = "upload" | "link";

type QueueStatus = "pending" | "uploading" | "success" | "error";

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: QueueStatus;
  errorMessage: string | null;
}

const MAX_MB = Math.floor(SALON_PHOTO_UPLOAD.maxBytes / (1024 * 1024));

function newQueueId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Client-side courtesy check only — file.type is whatever the OS guessed from the extension, so
 * the server re-decides by reading the file's magic bytes regardless of what passes here. */
function validateFile(file: File): string | null {
  const allowed = SALON_PHOTO_UPLOAD.allowedMimeTypes as readonly string[];
  if (!allowed.includes(file.type)) {
    return "Not a supported image (JPG, PNG or WebP).";
  }
  if (file.size > SALON_PHOTO_UPLOAD.maxBytes) {
    return `${(file.size / (1024 * 1024)).toFixed(1)} MB — over the ${MAX_MB} MB limit.`;
  }
  return null;
}

/**
 * Owner photo management.
 *
 * Two independent sections, matching how the two photo types are actually used: exactly one
 * COVER photo (replaced, never added to), and a GALLERY that owners build up over multiple
 * photos at once — from their device's gallery (multi-select) or straight from the camera, up to
 * SALON_PHOTO_UPLOAD.maxBatchCount per batch. Each queued gallery file previews and can be
 * removed before it ever reaches the network; "Upload All" then uploads every still-pending item
 * through the existing single-file endpoint (no batch endpoint needed — Multer already caps that
 * route at one file per request), tracking each file's own pending/uploading/success/error state
 * independently so one bad file never blocks the rest and a failed one can be retried alone
 * without re-selecting or re-uploading anything that already succeeded.
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

  // ---------- Cover photo (single, replace-in-place) ----------
  const [coverSource, setCoverSource] = useState<CoverSource>("upload");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [coverAltText, setCoverAltText] = useState("");
  const [coverSubmitting, setCoverSubmitting] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  // ---------- Gallery batch queue ----------
  const [galleryQueue, setGalleryQueue] = useState<QueueItem[]>([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryUrl, setGalleryUrl] = useState("");
  const [galleryLinkSubmitting, setGalleryLinkSubmitting] = useState(false);
  const galleryFileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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

  // The preview is an object URL over the file already in memory — never copied into a base64
  // string. Revoked on unmount and whenever a preview is replaced/removed, so navigating away or
  // clearing the queue never leaks a buffer.
  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);
  useEffect(() => {
    return () => {
      galleryQueue.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup, intentionally not re-run per queue change
  }, []);

  function clearCoverFile() {
    setCoverFile(null);
    setCoverPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    // Without this the input keeps the old selection, and re-picking the SAME file fires no
    // change event at all — the owner would click, choose, and see nothing happen.
    if (coverFileInputRef.current) coverFileInputRef.current.value = "";
  }

  function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    setSuccess(null);
    if (!chosen) {
      clearCoverFile();
      return;
    }
    const invalidReason = validateFile(chosen);
    if (invalidReason) {
      clearCoverFile();
      setError(`That file isn’t usable: ${invalidReason}`);
      return;
    }
    setError(null);
    setCoverFile(chosen);
    setCoverPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(chosen);
    });
  }

  function switchCoverSource(next: CoverSource) {
    setCoverSource(next);
    setError(null);
    setSuccess(null);
    if (next === "link") clearCoverFile();
    else setCoverUrl("");
  }

  function applyCreated(created: PhotoDto) {
    // A new cover demotes the previous one server-side; mirror that here so the list matches
    // without a refetch.
    setPhotos((prev) =>
      created.type === PhotoType.COVER
        ? [...(prev ?? []).map((p) => (p.type === PhotoType.COVER ? { ...p, type: PhotoType.GALLERY } : p)), created]
        : [...(prev ?? []), created],
    );
  }

  async function handleCoverSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (coverSubmitting) return; // guard alongside the disabled button — a double-tap on a slow phone can land two submits before React re-renders
    setSuccess(null);

    if (coverSource === "upload") {
      if (!coverFile) {
        setError("Please choose a photo to upload.");
        return;
      }
      setError(null);
      setCoverSubmitting(true);
      try {
        const form = new FormData();
        form.append("image", coverFile);
        if (coverAltText.trim()) form.append("altText", coverAltText.trim());
        form.append("type", PhotoType.COVER);
        const created = await apiFetch<PhotoDto>(`${base}/${DASHBOARD_PATHS.photoUpload}`, {
          method: "POST",
          body: form,
        });
        applyCreated(created);
        clearCoverFile();
        setCoverAltText("");
        setSuccess("Cover photo updated.");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not upload that photo. Please try again.");
      } finally {
        setCoverSubmitting(false);
      }
      return;
    }

    const parsed = createSalonPhotoSchema.safeParse({
      url: coverUrl.trim(),
      altText: coverAltText.trim() || undefined,
      type: PhotoType.COVER,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the photo link.");
      return;
    }
    setError(null);
    setCoverSubmitting(true);
    try {
      const created = await apiFetch<PhotoDto>(base, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      applyCreated(created);
      setCoverUrl("");
      setCoverAltText("");
      setSuccess("Cover photo updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that photo.");
    } finally {
      setCoverSubmitting(false);
    }
  }

  // ---------- Gallery: queueing ----------

  function addFilesToQueue(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSuccess(null);
    setError(null);

    const incoming = Array.from(files);
    const room = SALON_PHOTO_UPLOAD.maxBatchCount - galleryQueue.length;
    const accepted = incoming.slice(0, Math.max(room, 0));
    const overflow = incoming.length - accepted.length;

    const newItems: QueueItem[] = accepted.map((file) => ({
      id: newQueueId(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "pending",
      errorMessage: validateFile(file),
    }));

    setGalleryQueue((prev) => [...prev, ...newItems]);

    if (overflow > 0) {
      setError(
        `Only added ${accepted.length} of ${incoming.length} photos — a batch can hold up to ${SALON_PHOTO_UPLOAD.maxBatchCount} at once. Upload this batch first, then add the rest.`,
      );
    }

    // Reset both inputs so picking the exact same file(s) again later still fires a change event.
    if (galleryFileInputRef.current) galleryFileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  function removeQueueItem(id: string) {
    setGalleryQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  }

  function updateQueueItem(id: string, patch: Partial<QueueItem>) {
    setGalleryQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  async function uploadQueueItem(item: QueueItem): Promise<void> {
    updateQueueItem(item.id, { status: "uploading", errorMessage: null });
    try {
      const form = new FormData();
      form.append("image", item.file);
      form.append("type", PhotoType.GALLERY);
      const created = await apiFetch<PhotoDto>(`${base}/${DASHBOARD_PATHS.photoUpload}`, {
        method: "POST",
        body: form,
      });
      applyCreated(created);
      updateQueueItem(item.id, { status: "success" });
    } catch (err) {
      updateQueueItem(item.id, {
        status: "error",
        errorMessage: err instanceof ApiError ? err.message : "Upload failed. Please try again.",
      });
    }
  }

  // Uploads every still-pending, validation-passing item, one at a time — sequential rather than
  // parallel so N simultaneous multipart requests never compete for the same salon's photo list
  // and so upload order matches the order the owner queued them in. Already-uploading/succeeded
  // items are skipped even if this is somehow invoked twice, and the Upload All button itself is
  // disabled for the same reason (see the disabled prop below) — belt and braces against a
  // double-tap producing duplicate photo rows.
  async function uploadAll() {
    if (galleryUploading) return;
    const toUpload = galleryQueue.filter((q) => q.status === "pending" && !q.errorMessage);
    if (toUpload.length === 0) return;
    setGalleryUploading(true);
    setSuccess(null);
    setError(null);
    for (const item of toUpload) {
      // Re-check current status right before each upload: a fast retry click elsewhere could have
      // already started this exact item.
      const current = galleryQueue.find((q) => q.id === item.id);
      if (!current || current.status !== "pending") continue;
      await uploadQueueItem(item);
    }
    setGalleryUploading(false);
    setGalleryQueue((prev) => {
      const succeeded = prev.filter((q) => q.status === "success").length;
      if (succeeded > 0) {
        setSuccess(`Added ${succeeded} photo${succeeded === 1 ? "" : "s"} to your gallery.`);
      }
      // Successful items are already visible in the main gallery grid below — drop them from the
      // staging queue so it only ever shows what still needs attention (pending/failed).
      prev.filter((q) => q.status === "success").forEach((q) => URL.revokeObjectURL(q.previewUrl));
      return prev.filter((q) => q.status !== "success");
    });
  }

  async function retryQueueItem(id: string) {
    const item = galleryQueue.find((q) => q.id === id);
    if (!item || item.status === "uploading") return;
    await uploadQueueItem(item);
  }

  async function handleGalleryLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (galleryLinkSubmitting) return;
    const parsed = createSalonPhotoSchema.safeParse({
      url: galleryUrl.trim(),
      type: PhotoType.GALLERY,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the photo link.");
      return;
    }
    setError(null);
    setSuccess(null);
    setGalleryLinkSubmitting(true);
    try {
      const created = await apiFetch<PhotoDto>(base, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      applyCreated(created);
      setGalleryUrl("");
      setSuccess("Photo added to your gallery.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that photo.");
    } finally {
      setGalleryLinkSubmitting(false);
    }
  }

  async function handleRemovePhoto(photo: PhotoDto) {
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
  const galleryPhotos = (photos ?? []).filter((p) => p.type === PhotoType.GALLERY);
  const coverExternalPreview =
    coverSource === "link" &&
    createSalonPhotoSchema.safeParse({ url: coverUrl.trim(), type: PhotoType.COVER }).success
      ? coverUrl.trim()
      : null;
  const pendingCount = galleryQueue.filter((q) => q.status === "pending" && !q.errorMessage).length;
  const queueAtCapacity = galleryQueue.length >= SALON_PHOTO_UPLOAD.maxBatchCount;

  return (
    <RequireRole roles={[Role.SALON_OWNER, Role.PLATFORM_ADMIN]} redirectTo="/dashboard/salons">
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Photos</h1>
      <p className={styles.pageSubtitle}>
        Your cover photo is what customers see first when they find you. Photos are optional
        during setup.
      </p>
      <SetupNavigation salonId={salonId} currentStep="photos" section="steps" />

      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {success && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{success}</p>}

      {/* ---------- Cover photo ---------- */}
      <section style={{ margin: "20px 0 28px" }}>
        <h2 className={styles.sectionHeading} style={{ fontSize: 15 }}>Cover photo</h2>
        <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
          One photo, shown first everywhere your shop appears. Uploading a new one replaces it.
        </p>
        <div style={{ maxWidth: 300, marginBottom: 14 }}>
          <SalonImage url={cover?.url ?? null} alt={cover?.altText ?? "Your shop's cover photo"} priority />
        </div>

        <form onSubmit={handleCoverSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className={styles.toggleRow} role="group" aria-label="How to set the cover photo">
            <button
              type="button"
              onClick={() => switchCoverSource("upload")}
              aria-pressed={coverSource === "upload"}
              className={`${styles.toggle} ${coverSource === "upload" ? styles.toggleActive : ""}`}
            >
              Upload photo
            </button>
            <button
              type="button"
              onClick={() => switchCoverSource("link")}
              aria-pressed={coverSource === "link"}
              className={`${styles.toggle} ${coverSource === "link" ? styles.toggleActive : ""}`}
            >
              Paste photo link
            </button>
          </div>

          {coverSource === "upload" ? (
            <div>
              <input
                ref={coverFileInputRef}
                id="cover-photo-file"
                type="file"
                accept={SALON_PHOTO_UPLOAD.accept}
                onChange={handleCoverFileChange}
                style={visuallyHiddenInput}
              />
              <label htmlFor="cover-photo-file" style={fileLabelStyle}>
                {coverFile ? "Choose a different photo" : "+ Choose photo"}
              </label>
              <p className={styles.hint}>JPG, PNG or WebP, up to {MAX_MB} MB.</p>

              {coverFile && coverPreviewUrl && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ maxWidth: 260 }}>
                    <SalonImage url={coverPreviewUrl} alt="Preview of the photo you selected" priority />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                    <span className={styles.hint} style={{ marginTop: 0, wordBreak: "break-all" }}>
                      {coverFile.name} · {(coverFile.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                    <Button type="button" variant="outline" onClick={clearCoverFile}>
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className={styles.fieldLabel} htmlFor="cover-photo-url">Photo link</label>
              <input
                id="cover-photo-url"
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                className={styles.input}
              />
              {coverExternalPreview && (
                <div style={{ maxWidth: 260, marginTop: 12 }}>
                  <SalonImage url={coverExternalPreview} alt="Preview of the direct image URL" priority />
                </div>
              )}
            </div>
          )}

          <div>
            <label className={styles.fieldLabel} htmlFor="cover-photo-alt">Describe the photo (optional)</label>
            <input
              id="cover-photo-alt"
              placeholder="The front of your shop"
              value={coverAltText}
              onChange={(e) => setCoverAltText(e.target.value)}
              maxLength={200}
              className={styles.input}
            />
          </div>
          <div>
            <Button type="submit" variant="secondary" disabled={coverSubmitting}>
              {coverSubmitting ? (coverSource === "upload" ? "Uploading…" : "Saving…") : "Set cover photo"}
            </Button>
          </div>
        </form>
      </section>

      {/* ---------- Gallery ---------- */}
      <section style={{ margin: "20px 0 28px" }}>
        <h2 className={styles.sectionHeading} style={{ fontSize: 15 }}>Gallery</h2>
        <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
          Add up to {SALON_PHOTO_UPLOAD.maxBatchCount} photos at once — from your device or
          straight from the camera — review them below, then upload the batch.
        </p>

        <input
          ref={galleryFileInputRef}
          id="gallery-photo-files"
          type="file"
          accept={SALON_PHOTO_UPLOAD.accept}
          multiple
          onChange={(e) => addFilesToQueue(e.target.files)}
          style={visuallyHiddenInput}
        />
        <input
          ref={cameraInputRef}
          id="gallery-photo-camera"
          type="file"
          accept={SALON_PHOTO_UPLOAD.accept}
          capture="environment"
          onChange={(e) => addFilesToQueue(e.target.files)}
          style={visuallyHiddenInput}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label
            htmlFor="gallery-photo-files"
            style={{ ...fileLabelStyle, opacity: queueAtCapacity ? 0.5 : 1, pointerEvents: queueAtCapacity ? "none" : "auto" }}
            aria-disabled={queueAtCapacity}
          >
            + Choose from gallery
          </label>
          <label
            htmlFor="gallery-photo-camera"
            style={{ ...fileLabelStyle, opacity: queueAtCapacity ? 0.5 : 1, pointerEvents: queueAtCapacity ? "none" : "auto" }}
            aria-disabled={queueAtCapacity}
          >
            📷 Take a photo
          </label>
        </div>
        <p className={styles.hint}>
          JPG, PNG or WebP, up to {MAX_MB} MB each. {galleryQueue.length}/{SALON_PHOTO_UPLOAD.maxBatchCount} queued.
        </p>

        {galleryQueue.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <ul className={styles.queueGrid}>
              {galleryQueue.map((item) => (
                <li key={item.id} className={styles.photoGridItem} style={{ border: "1px solid var(--bc-border)", borderRadius: "var(--bc-radius-sm)", padding: 8 }}>
                  <SalonImage url={item.previewUrl} alt={item.file.name} />
                  <p className={styles.hint} style={{ marginTop: 6, marginBottom: 4, wordBreak: "break-all" }}>
                    {item.file.name} · {(item.file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      margin: "0 0 6px",
                      color:
                        item.status === "error"
                          ? "var(--bc-danger, #b91c1c)"
                          : item.status === "success"
                            ? "var(--bc-success, #15803d)"
                            : "var(--bc-muted)",
                    }}
                    role={item.status === "error" ? "alert" : undefined}
                  >
                    {item.status === "pending" && !item.errorMessage && "Ready to upload"}
                    {item.status === "uploading" && "Uploading…"}
                    {item.status === "success" && "Uploaded ✓"}
                    {(item.status === "error" || item.errorMessage) && (item.errorMessage ?? "Upload failed.")}
                  </p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {item.status === "error" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void retryQueueItem(item.id)}
                        disabled={galleryUploading}
                      >
                        Retry
                      </Button>
                    )}
                    {item.status !== "uploading" && item.status !== "success" && (
                      <Button type="button" variant="outline" onClick={() => removeQueueItem(item.id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 12 }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void uploadAll()}
                disabled={galleryUploading || pendingCount === 0}
              >
                {galleryUploading ? "Uploading…" : `Upload All (${pendingCount})`}
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={handleGalleryLinkSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420, marginTop: 20 }}>
          <label className={styles.fieldLabel} htmlFor="gallery-photo-url">Or paste a photo link</label>
          <input
            id="gallery-photo-url"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={galleryUrl}
            onChange={(e) => setGalleryUrl(e.target.value)}
            className={styles.input}
          />
          <p className={styles.hint} style={{ marginTop: 0 }}>
            Use a direct HTTPS URL ending in an image response. Google Business or Instagram
            share-page links may block embedding and are not guaranteed to work.
          </p>
          <div>
            <Button type="submit" variant="outline" disabled={galleryLinkSubmitting || !galleryUrl.trim()}>
              {galleryLinkSubmitting ? "Adding…" : "Add link"}
            </Button>
          </div>
        </form>
      </section>

      {photos === null && !error && <p className={styles.loadingText}>Loading…</p>}
      {photos && photos.length > 0 && (
        <section>
          <h2 className={styles.sectionHeading} style={{ fontSize: 15 }}>
            Your photos
          </h2>
          {galleryPhotos.length === 0 && !cover && (
            <p className={styles.emptyState}>No photos yet. Set your cover photo above.</p>
          )}
          <ul className={styles.photoGrid}>
            {photos
              .slice()
              .sort((a) => (a.type === PhotoType.COVER ? -1 : 1))
              .map((p) => (
                <li key={p.id} className={styles.photoGridItem}>
                  <SalonImage url={p.url} alt={p.altText ?? "Shop photo"} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <span className={styles.rowMeta}>
                      {p.type === PhotoType.COVER ? "Cover" : "Gallery"}
                    </span>
                    <Button type="button" variant="outline" onClick={() => void handleRemovePhoto(p)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      )}
      <SetupNavigation salonId={salonId} currentStep="photos" section="actions" />
    </main>
    </RequireRole>
  );
}

const visuallyHiddenInput: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const fileLabelStyle: React.CSSProperties = {
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
};
