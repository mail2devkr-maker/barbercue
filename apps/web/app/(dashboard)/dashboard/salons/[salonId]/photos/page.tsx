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
  // Issue 11 — multiple files selected together (`multiple` on the input below) each get their
  // own preview and their own upload request to the existing single-file endpoint below; nothing
  // about the backend contract changes; the batch is just this array processed one at a time.
  const [files, setFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const [url, setUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [type, setType] = useState<PhotoType>(PhotoType.COVER);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mirrors `files` so the unmount-only cleanup effect below can revoke whatever is pending at
  // the moment of unmount, not whatever `files` happened to be when the effect first ran.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

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
  // browser only holds it until it is revoked, and every revoke goes through clearFiles below or
  // this unmount cleanup, so navigating away never leaks the buffer.
  useEffect(() => {
    return () => {
      for (const f of filesRef.current) URL.revokeObjectURL(f.previewUrl);
    };
    // Only the unmount cleanup matters here — files themselves are revoked individually wherever
    // they're removed (clearFiles, removePendingFile, or replaced in handleFileChange); reading
    // through filesRef rather than depending on `files` directly means this never needs to re-run.
  }, []);

  function clearFiles() {
    setFiles((prev) => {
      for (const f of prev) URL.revokeObjectURL(f.previewUrl);
      return [];
    });
    // Without this the input keeps the old selection, and re-picking the SAME file(s) fires no
    // change event at all — the owner would click, choose, and see nothing happen.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingFile(index: number) {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    setSuccess(null);
    if (chosen.length === 0) {
      clearFiles();
      return;
    }

    // Client-side checks are a courtesy — they save the owner a pointless upload and give an
    // instant answer. They are NOT the security boundary: file.type is whatever the OS guessed
    // from the extension, so the server re-decides by reading the file's magic bytes.
    const allowed = SALON_PHOTO_UPLOAD.allowedMimeTypes as readonly string[];
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const candidate of chosen) {
      if (!allowed.includes(candidate.type)) {
        rejected.push(`${candidate.name} (unsupported file type)`);
      } else if (candidate.size > SALON_PHOTO_UPLOAD.maxBytes) {
        rejected.push(`${candidate.name} (over ${MAX_MB} MB)`);
      } else {
        accepted.push(candidate);
      }
    }

    setError(
      rejected.length > 0
        ? `Skipped ${rejected.length === 1 ? "1 file" : `${rejected.length} files`}: ${rejected.join(", ")}. Please use JPG, PNG or WebP under ${MAX_MB} MB.`
        : null,
    );
    setFiles((prev) => {
      for (const f of prev) URL.revokeObjectURL(f.previewUrl);
      return accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    });
  }

  function switchSource(next: Source) {
    setSource(next);
    setError(null);
    setSuccess(null);
    // Whichever input is being left behind is emptied, so a stale value from the other route can
    // never be submitted by accident.
    if (next === "link") clearFiles();
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
      if (files.length === 0) {
        setError("Please choose a photo to upload.");
        return;
      }
      setError(null);
      setSubmitting(true);
      // Captured once, before any upload starts — applyCreated below resets the altText field
      // after each success, and re-reading the (by-then-cleared) state mid-batch would silently
      // drop the description from every file after the first.
      const sharedAltText = altText.trim();
      // Uploaded one at a time against the existing single-file endpoint (Issue 11) rather than
      // in parallel: sequential keeps upload order == the order the owner picked them in (matters
      // for which one ends up as COVER — see applyCreated's own comment), and means a failure
      // is attributed to exactly one named file rather than an ambiguous batch of settled promises.
      const succeeded: PhotoDto[] = [];
      const failed: string[] = [];
      for (const { file } of files) {
        try {
          const form = new FormData();
          form.append("image", file);
          if (sharedAltText) form.append("altText", sharedAltText);
          form.append("type", type);
          // No Content-Type header — apiFetch deliberately leaves FormData alone so the browser
          // can set the multipart boundary itself.
          const created = await apiFetch<PhotoDto>(`${base}/${DASHBOARD_PATHS.photoUpload}`, {
            method: "POST",
            body: form,
          });
          applyCreated(created);
          succeeded.push(created);
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof ApiError ? err.message : "upload failed"}`);
        }
      }
      setSubmitting(false);
      clearFiles();
      if (failed.length > 0) {
        setError(
          succeeded.length > 0
            ? `Added ${succeeded.length} of ${files.length} photos. Failed: ${failed.join("; ")}`
            : `Could not upload: ${failed.join("; ")}`,
        );
      } else if (succeeded.length > 1) {
        // applyCreated's own per-file message ("Cover photo updated." / "Photo added to your
        // gallery.") only reflects the LAST file in a successful batch — replaced with an accurate
        // count here rather than leaving a message that silently undercounts what was added.
        setSuccess(`Added ${succeeded.length} photos.`);
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
              multiple
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
              {files.length > 0 ? "Choose different photos" : "+ Choose photos"}
            </label>
            <p className={styles.hint}>
              JPG, PNG or WebP, up to {MAX_MB} MB each. Select several at once to upload them
              together.
            </p>

            {files.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 12,
                }}
              >
                {files.map((entry, index) => (
                  <div key={`${entry.file.name}-${index}`}>
                    <div style={{ maxWidth: 140 }}>
                      {/* priority (eager) rather than the default lazy load: these are the images
                          the owner just picked and is waiting to see, so deferring them until they
                          scroll into view would leave the preview blank at exactly the wrong
                          moment. */}
                      <SalonImage url={entry.previewUrl} alt={`Preview of ${entry.file.name}`} priority />
                    </div>
                    <p className={styles.hint} style={{ marginTop: 4, wordBreak: "break-all" }}>
                      {entry.file.name} · {(entry.file.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                    <Button type="button" variant="outline" onClick={() => removePendingFile(index)}>
                      Remove
                    </Button>
                  </div>
                ))}
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
