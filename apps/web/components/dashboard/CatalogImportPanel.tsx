"use client";

import { useRef, useState } from "react";
import { normalizeServiceIdentity } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";

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
  const [allowAi, setAllowAi] = useState(false);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);

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
    setWorking(true);
    setError(null);
    const notices: string[] = [];
    const collected: ReviewRow[] = [];
    for (const file of files) {
      if (external.test(file.name) && !allowAi) {
        notices.push(file.name + ": confirm Google Gemini processing to extract PDF/photo data.");
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      body.append("consent", allowAi ? "true" : "false");
      try {
        const result = await apiFetch<PreviewResult>(basePath + "/import-preview", {
          method: "POST",
          body,
        });
        const extracted = result.services.map((row) => ({
          ...row, key: ++idCounter.current, selected: true,
        }));
        collected.push(...extracted);
        notices.push(file.name + ": " + extracted.length + " candidates extracted.");
      } catch (cause) {
        notices.push(file.name + ": " + (cause instanceof ApiError ? cause.message : "Could not extract."));
      }
    }
    setRows((current) => [...current, ...collected]);
    setFiles([]);
    if (fileInput.current) fileInput.current.value = "";
    setMessages(notices);
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
  const importable = rows.filter((row) => row.selected && !flagged.has(row.key));
  const needsAttention = rows.filter((row) => row.selected && flagged.has(row.key));
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
      await onImported();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Import failed; no confirmation of saved services.");
    } finally { setSaving(false); }
  }

  return (
    <section aria-labelledby="catalog-import-heading" style={styles.shell}>
      <h2 id="catalog-import-heading" style={{ marginTop: 0 }}>📁 Import services from catalogs</h2>
      <p style={styles.help}>
        Upload multiple shop menus and review the extracted services before saving.
        Supported: XLSX, CSV, PDF, JPG, PNG and WEBP. For older XLS files, save as XLSX first.
        Prices and durations not clearly present in the catalog must be completed manually.
      </p>
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
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, fontSize: 14 }}>
        <input type="checkbox" checked={allowAi} onChange={(event) => setAllowAi(event.target.checked)} disabled={working || saving} />
        <span>
          I authorize sending uploaded PDF/photo catalogs to Google Gemini for AI extraction.
          Processing may have provider costs. Spreadsheet/CSV extraction stays on the server.
        </span>
      </label>
      <button type="button" style={styles.button} disabled={working || saving || !files.length} onClick={() => void extract()}>
        {working ? "Extracting files…" : "Extract & preview (" + files.length + ")"}
      </button>
      {error && <p role="alert" style={{ color: "#b42318", fontWeight: 600 }}>{error}</p>}
      {!!messages.length && <div role="status" aria-live="polite" style={{ marginTop: 14 }}>{messages.map((message, i) => <p key={i} style={styles.help}>{message}</p>)}</div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Review extracted services ({rows.length})</h3>
          <p style={styles.help}>All extracted values are drafts. Edit every uncertain entry. Existing services are never overwritten.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" style={styles.secondary} onClick={selectAll}>Select all</button>
            <button type="button" style={styles.secondary} onClick={selectNone}>Select none</button>
            <button type="button" style={styles.secondary} onClick={() => setRows([])}>Discard all previews</button>
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
            {saving ? "Importing…" : "Import " + importable.length + " reviewed services"}
          </button>
          {importable.length > 200 && <p role="alert">Import up to 200 rows at a time. Deselect some rows and import in batches.</p>}
        </div>
      )}
    </section>
  );
}
