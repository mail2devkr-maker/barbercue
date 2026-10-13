"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeServiceIdentity } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { extractCatalogLocally, parseCatalogRateText } from "../../lib/catalog-local-ocr";

interface Candidate {
  name: string;
  category: string;
  description: string;
  price: number | null;
  durationMinutes: number | null;
  source: string;
}
interface ReviewRow extends Candidate { key: number; selected: boolean; }
interface PreviewResult {
  filename: string;
  format: string;
  services: Candidate[];
  requiresReview: boolean;
}
interface ImportResult {
  createdCount: number;
  skippedCount: number;
  added: string[];
  skipped: string[];
}
const supported = ".xlsx,.csv,.tsv,.txt,.pdf,.jpg,.jpeg,.png,.webp";
const external = /\.(pdf|jpe?g|png|webp)$/i;
const fileLimit = 6 * 1024 * 1024;
const styles = {
  shell: { border: "1px solid var(--bc-border)", background: "var(--bc-surface)", borderRadius: 16, padding: 20, margin: "22px 0" } as const,
  help: { color: "var(--bc-muted)", fontSize: 14, lineHeight: 1.6 } as const,
  button: { padding: "10px 16px", borderRadius: 10, border: "1px solid var(--bc-border)", background: "var(--bc-accent)", color: "#fff", cursor: "pointer", fontWeight: 600 } as const,
  secondary: { padding: "7px 10px", borderRadius: 9, border: "1px solid var(--bc-border)", background: "var(--bc-surface)", color: "var(--bc-ink)", cursor: "pointer" } as const,
  input: { width: "100%", minWidth: 72, padding: "8px", color: "var(--bc-ink)", border: "1px solid var(--bc-border)", borderRadius: 8, background: "var(--bc-surface)" } as const,
};
function valid(candidate: Candidate): boolean {
  return !!candidate.name.trim() && candidate.name.trim().length <= 120 &&
    candidate.category.length <= 60 && candidate.description.length <= 1000 &&
    candidate.price !== null && Number.isFinite(candidate.price) &&
    candidate.price >= 0 && candidate.price <= 1_000_000 &&
    candidate.durationMinutes !== null && Number.isInteger(candidate.durationMinutes) &&
    candidate.durationMinutes >= 5 && candidate.durationMinutes <= 480;
}
export function CatalogImportPanel(props: {
  basePath: string;
  existingServices: SalonServiceDto[];
  onImported: () => Promise<void> | void;
}) {
  const { basePath, existingServices, onImported } = props;
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocrAvailable, setOcrAvailable] = useState<boolean | null>(null);
  const [useDeviceOcr, setUseDeviceOcr] = useState(true);
  const [ocrProgress, setOcrProgress] = useState("");
  const [recognizedText, setRecognizedText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);

  useEffect(() => {
    let active = true;
    setOcrAvailable(null);
    void apiFetch<{ pdfPhotoOcrAvailable: boolean }>(basePath + "/import-capabilities")
      .then((result) => { if (active) setOcrAvailable(result.pdfPhotoOcrAvailable); })
      .catch(() => { /* Older backend versions may not have the status endpoint. */ });
    return () => { active = false; };
  }, [basePath]);

  function addFiles(more: FileList | File[]) {
    const additions = Array.from(more);
    setError(null);
    setFiles((current) => {
      const next = [...current];
      for (const file of additions) {
        if (!supported.split(",").some((extension) => file.name.toLowerCase().endsWith(extension))) {
          setError("Unsupported file: " + file.name + ". Save old .xls spreadsheets as .xlsx.");
          continue;
        }
        if (!file.size || file.size > fileLimit) {
          setError("File is empty or exceeds 6 MB: " + file.name);
          continue;
        }
        if (next.length >= 8) { setError("Upload up to 8 catalogs at once. Additional batches are supported."); break; }
        if (next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) continue;
        next.push(file);
      }
      return next;
    });
  }

  function updateRow(key: number, changes: Partial<ReviewRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...changes } : row));
  }

  async function extract() {
    if (!files.length || working || saving) return;

    // Keep the Services page uncluttered, but request explicit, just-in-time
    // consent before transmitting any private PDF/photo catalog to Google Gemini.
    // A declined confirmation leaves the selected files in place and uploads nothing.
    const needsExternalProcessing = files.some((file) => external.test(file.name));
    if (needsExternalProcessing && !useDeviceOcr && ocrAvailable !== true) {
      setError("Cloud OCR is not configured. Enable private on-device extraction to read PDF/photos.");
      return;
    }
    if (needsExternalProcessing && !useDeviceOcr && !window.confirm(
      "PDF and photo catalogs are sent to Google Gemini for AI extraction. " +
      "An external provider will process these files, and provider charges may apply. " +
      "Do you agree to send the selected PDF/photo catalogs?"
    )) return;

    setWorking(true);
    setOcrProgress("");
    setError(null);
    const notices: string[] = [];
    const collected: ReviewRow[] = [];
    const failed: File[] = [];
    for (const file of files) {
      try {
        let result: PreviewResult;
        if (external.test(file.name) && useDeviceOcr) {
          // PDF/photo bytes never leave this browser; only reviewed service rows are saved.
          const local = await extractCatalogLocally(file, setOcrProgress);
          result = { filename: file.name, format: "on-device", services: local.services, requiresReview: true };
          if (local.text.trim()) setRecognizedText((current) =>
            (current ? current + "\n" : "") + local.text
          );
          notices.push(...local.notes.map((note) => file.name + ": " + note));
        } else {
          const body = new FormData();
          body.append("file", file);
          body.append("consent", external.test(file.name) && needsExternalProcessing ? "true" : "false");
          result = await apiFetch<PreviewResult>(basePath + "/import-preview", {
            method: "POST",
            body,
          });
        }
        const extracted = result.services.map((row) => ({
          ...row, key: ++idCounter.current, selected: true,
        }));
        if (extracted.length === 0) {
          failed.push(file);
          notices.push(file.name + ": No services detected. Check the file content and try again.");
          continue;
        }
        collected.push(...extracted);
        notices.push(file.name + ": " + extracted.length + " candidates extracted.");
      } catch (cause) {
        failed.push(file);
        notices.push(file.name + ": " + (cause instanceof ApiError ? cause.message : "Could not extract."));
      }
    }
    setRows((current) => [...current, ...collected]);
    // Keep failed uploads for retry without duplicating successful previews.
    setFiles(failed);
    if (fileInput.current) fileInput.current.value = "";
    setMessages(notices);
    setOcrProgress("");
    if (failed.length) setError(failed.length + " file(s) failed. See the reasons below; failed files are kept for retry.");
    setWorking(false);
  }

  const existing = new Set(existingServices.map((s) => normalizeServiceIdentity(s.name, s.category)));
  const seen = new Set<string>();
  const flagged = new Map<number, string>();
  for (const row of rows) {
    const identity = normalizeServiceIdentity(row.name, row.category || undefined);
    if (!row.name.trim()) flagged.set(row.key, "Enter a service name");
    else if (existing.has(identity)) flagged.set(row.key, "Already in this shop — skipped");
    else if (seen.has(identity)) flagged.set(row.key, "Duplicate in uploaded catalogs");
    else if (!valid(row)) flagged.set(row.key, "Missing or invalid price/duration — review");
    seen.add(identity);
  }
  const selectedRows = rows.filter((row) => row.selected);
  const importable = selectedRows.filter((row) => !flagged.has(row.key));
  const needsAttention = selectedRows.filter((row) => flagged.has(row.key));
  const missingDuration = selectedRows.filter((row) =>
    row.durationMinutes === null || !Number.isInteger(row.durationMinutes) ||
    row.durationMinutes < 5 || row.durationMinutes > 480
  ).length;
  const missingPrice = selectedRows.filter((row) =>
    row.price === null || !Number.isFinite(row.price) ||
    row.price < 0 || row.price > 1_000_000
  ).length;
  const selectAll = () => setRows((current) => current.map((row) => ({ ...row, selected: true })));
  const selectNone = () => setRows((current) => current.map((row) => ({ ...row, selected: false })));

  async function save() {
    if (!importable.length || saving || working) return;
    if (!window.confirm("Import " + importable.length + " reviewed services into this shop? Existing services will not be overwritten.")) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<ImportResult>(basePath + "/import-reviewed", {
        method: "POST",
        body: JSON.stringify({
          services: importable.map((row) => ({
            name: row.name.trim(),
            category: row.category.trim() || undefined,
            description: row.description.trim() || undefined,
            price: row.price,
            durationMinutes: row.durationMinutes,
          })),
        }),
      });
      setRows((current) => current.filter((row) => !importable.some((item) => item.key === row.key)));
      setMessages([
        result.createdCount + " services added; " + result.skippedCount + " already existed.",
        ...(result.skipped.length ? ["Skipped: " + result.skipped.join(", ")] : []),
      ]);
      try {
        await onImported();
      } catch {
        // POST succeeded; do not invite a retry that could duplicate created services.
        setError("Services were saved, but the list could not refresh. Reload to see them.");
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Import failed; no confirmation of saved services.");
    } finally { setSaving(false); }
  }

  return (
    <section aria-labelledby="catalog-import-heading" style={styles.shell}>
      <h2 id="catalog-import-heading" style={{ marginTop: 0 }}>📁 Import services from catalogs</h2>
      {ocrAvailable === false && (
        <p role="status" style={{ ...styles.help, padding: 12, border: "1px solid #b45309", borderRadius: 9 }}>
          Cloud PDF/photo extraction is not configured. Free on-device OCR is available below
          without a Gemini API key. Image/PDF bytes stay on your device; OCR models download on first use.
          Check extracted prices and durations before saving.
        </p>
      )}
      <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, ...styles.help }}>
        <input type="checkbox" checked={useDeviceOcr} disabled={working || saving || ocrAvailable === false}
          onChange={(event) => setUseDeviceOcr(event.target.checked)} />
        Read PDF/photo locally on this device (recommended; no third-party catalog upload)
      </label>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); if (!working && !saving) addFiles(event.dataTransfer.files); }}
        style={{ padding: 18, border: "2px dashed var(--bc-border)", borderRadius: 12, margin: "15px 0" }}
      >
        <label htmlFor="catalog-multiple-input" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Choose files or drop them here (up to 8 per batch, 6 MB each)
        </label>
        <input
          ref={fileInput}
          id="catalog-multiple-input"
          type="file"
          accept={supported}
          multiple
          disabled={working || saving}
          onChange={(event) => { if (event.target.files) addFiles(event.target.files); }}
        />
        {files.length > 0 && (
          <ul>
            {files.map((file, i) => (
              <li key={file.name + i}>
                {file.name} — {(file.size / 1024).toFixed(0)} KB{" "}
                <button type="button" style={styles.secondary} disabled={working} onClick={() => setFiles((items) => items.filter((_, index) => index !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && <p role="status" style={styles.help}>
        {files.length} file(s) selected. Next: click <strong>Extract &amp; preview</strong> below.
        Selecting a file does not add services; you will review names, prices and durations first.
      </p>}
      <button type="button" style={styles.button} disabled={working || saving || !files.length} onClick={() => void extract()}>
        {working ? "Extracting files…" : "Step 1: Extract & preview (" + files.length + ")"}
      </button>
      {!!ocrProgress && <p role="status" aria-live="polite" style={styles.help}>{ocrProgress}</p>}
      {error && <p role="alert" style={{ color: "#b42318", fontWeight: 600 }}>{error}</p>}
      {!!messages.length && <div role="status" aria-live="polite" style={{ marginTop: 14 }}>{messages.map((message, i) => <p key={i} style={styles.help}>{message}</p>)}</div>}
      {recognizedText.trim().length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer" }}>Review and edit locally recognized PDF/photo text</summary>
          <p style={styles.help}>Uncertain OCR results should be corrected before parsing. This draft is not published.</p>
          <textarea aria-label="Recognized catalog text" value={recognizedText}
            onChange={(e) => setRecognizedText(e.target.value)}
            rows={9} style={{ ...styles.input, minHeight: 160 }} />
          <div style={{ marginTop: 8 }}>
            <button type="button" style={styles.secondary} disabled={working || saving}
              onClick={() => {
                const entries = parseCatalogRateText(recognizedText, "Edited local OCR");
                setRows((current) => [...current, ...entries.map((item) => ({
                  ...item, key: ++idCounter.current, selected: true,
                }))]);
                setMessages(["Extracted " + entries.length + " candidate(s) from edited text. Review duplicates, prices and durations."]);
              }}>Parse edited text into review rows</button>
          </div>
        </details>
      )}
      {rows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Step 2: Review extracted services ({rows.length})</h3>
          <p style={styles.help}>All extracted values are drafts. Edit every uncertain entry. Existing services are never overwritten.</p>
          <div role="status" aria-live="polite" style={{
            ...styles.help, padding: 14, margin: "12px 0",
            border: "1px solid var(--bc-border)", borderRadius: 10,
          }}>
            <strong>{importable.length} ready to add out of {selectedRows.length} selected.</strong>
            {missingDuration > 0 && <p style={{ margin: "6px 0" }}>
              {missingDuration} selected row(s) need a valid duration (5–480 minutes).
              The catalog does not state most treatment times; please enter the salon-approved duration.
            </p>}
            {missingPrice > 0 && <p style={{ margin: "6px 0" }}>
              {missingPrice} selected row(s) need one exact approved price.
              Catalog price ranges cannot be automatically converted to a single price.
            </p>}
            {needsAttention.length > 0 && <p style={{ margin: "6px 0" }}>
              Review red row messages below for missing values, duplicates and existing services.
            </p>}
            <p style={{ margin: "6px 0 0" }}>
              Next: complete or deselect blocked rows, then choose <strong>Add reviewed services</strong>.
              Previewing does not save anything to the shop.
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <button type="button" style={styles.secondary} onClick={selectAll}>Select all</button>
            <button type="button" style={styles.secondary} onClick={selectNone}>Select none</button>
            <button type="button" style={styles.secondary} onClick={() => setRows([])}>Discard all previews</button>
            {rows.some((row) => row.selected && row.durationMinutes === null) && (
              <button type="button" style={styles.secondary} onClick={() => {
                if (!window.confirm(
                  "Use 30 minutes for ALL selected services with missing durations? " +
                  "This is NOT taken from the catalog. Apply only if Glow & Gaze's owner approves " +
                  "30 minutes for each affected service, including longer treatments."
                )) return;
                setRows((current) => current.map((row) =>
                  row.selected && row.durationMinutes === null ? { ...row, durationMinutes: 30 } : row
                ));
              }}>
                Set blank durations to 30 min (requires owner approval)
              </button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 790, borderCollapse: "separate", borderSpacing: "0 8px" }}>
              <thead><tr><th scope="col">✓</th><th scope="col">Service</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Minutes</th><th scope="col">Details</th><th scope="col">Source / Status</th><th scope="col">Remove</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.key}>
                  <td><input type="checkbox" checked={row.selected} aria-label={"Select " + row.name} onChange={(e) => updateRow(row.key, { selected: e.target.checked })} /></td>
                  <td><input style={styles.input} aria-label="Service name" maxLength={120} value={row.name} onChange={(e) => updateRow(row.key, { name: e.target.value })} /></td>
                  <td><input style={styles.input} aria-label="Category" maxLength={60} value={row.category} onChange={(e) => updateRow(row.key, { category: e.target.value })} /></td>
                  <td><input style={styles.input} aria-label="Price" type="number" min={0} max={1000000} step="0.01" value={row.price ?? ""} onChange={(e) => updateRow(row.key, { price: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td><input style={styles.input} aria-label="Minutes" type="number" min={5} max={480} step={1} value={row.durationMinutes ?? ""} onChange={(e) => updateRow(row.key, { durationMinutes: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td><input style={styles.input} aria-label="Details" maxLength={1000} value={row.description} onChange={(e) => updateRow(row.key, { description: e.target.value })} /></td>
                  <td style={{ fontSize: 12, maxWidth: 220 }}>
                    {row.source}
                    {flagged.has(row.key) && <p style={{ color: "#b42318", fontWeight: 600 }}>{flagged.get(row.key)}</p>}
                  </td>
                  <td><button type="button" style={styles.secondary} aria-label={"Remove " + row.name} onClick={() => setRows((items) => items.filter((item) => item.key !== row.key))}>×</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {needsAttention.length > 0 && <p style={styles.help}>{needsAttention.length} selected entries need correction, are duplicates, or already exist. They will not be imported.</p>}
          <button type="button" style={styles.button} disabled={saving || working || importable.length === 0 || importable.length > 200} onClick={() => void save()}>
            {saving ? "Adding services…" : "Step 3: Add " + importable.length + " reviewed services to this shop"}
          </button>
          {importable.length === 0 && <p role="status" style={styles.help}>
            Add services is disabled because no selected row has an approved name, exact price,
            and duration yet. Edit the fields above (or select eligible rows) to enable it.
          </p>
          {importable.length > 200 && <p role="alert">Import up to 200 rows at a time. Deselect some rows and import in batches.</p>}
        </div>
      )}
    </section>
  );
}
