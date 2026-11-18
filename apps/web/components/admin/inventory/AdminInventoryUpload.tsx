"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ADMIN_PATHS,
  INVENTORY_UPLOAD_MAX_BYTES,
  INVENTORY_UPLOAD_PATHS as P,
  Role,
  UPLOAD_FIELDS,
  UPLOAD_FIELD_LABELS,
  type InventoryPageDto,
  type InventoryUploadIssueDto,
  type InventoryUploadJobDto,
  type InventoryUploadPreviewDto,
  type UploadColumnMapping,
  type UploadField,
  type UploadRowAction,
} from "@barbercue/shared";
import { apiFetch, apiFetchBlob, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import ui from "../../owner/owner.module.css";
import css from "./admin-inventory.module.css";

const BASE = `${ADMIN_PATHS.admin}/${P.uploads}`;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);

export const ACTION_LABEL: Record<UploadRowAction, string> = {
  CREATE_GLOBAL: "New global product",
  CREATE_SHOP: "New shop-only product",
  LINK_SHOP: "Add to shop",
  UNCHANGED: "Already in catalog",
  SKIP: "Skipped",
  REVIEW: "Needs admin review",
};
const ACTION_TONE: Record<UploadRowAction, string> = {
  CREATE_GLOBAL: css.statusVERIFIED,
  CREATE_SHOP: css.statusVERIFIED,
  LINK_SHOP: css.statusVERIFIED,
  UNCHANGED: "",
  SKIP: css.statusREJECTED,
  REVIEW: css.statusPENDING,
};
const STATUS_LABEL: Record<InventoryUploadJobDto["status"], string> = {
  PREVIEWED: "Waiting for confirmation",
  PROCESSING: "Importing",
  COMPLETED: "Imported",
  COMPLETED_WITH_ERRORS: "Imported with issues",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

async function download(path: string, fallbackName: string) {
  const { blob, filename } = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Admin → Inventory → Upload Inventory. One prominent "Upload Product Database" button; the file is
 * checked on the server (header detection, column mapping, validation, duplicates, shop matching)
 * and shown as a preview. Nothing is saved until "Confirm import". Re-importing a file is safe.
 */
export function AdminInventoryUpload() {
  const { user } = useAuth();
  const canManage = !!user?.roles.some((r) => r === Role.PLATFORM_ADMIN || r === Role.CO_FOUNDER);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceReference, setSourceReference] = useState("");
  const [sourceLicense, setSourceLicense] = useState("");
  const [markAsTestData, setMarkAsTestData] = useState(false);
  const [mapping, setMapping] = useState<UploadColumnMapping | null>(null);
  const [preview, setPreview] = useState<InventoryUploadPreviewDto | null>(null);
  const [result, setResult] = useState<InventoryUploadJobDto | null>(null);
  const [busy, setBusy] = useState<"" | "checking" | "importing" | "cancelling">("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "PROBLEMS" | UploadRowAction>("ALL");
  const [dragOver, setDragOver] = useState(false);

  async function runPreview(chosen: File, override: UploadColumnMapping | null, sheetName?: string | null) {
    if (chosen.size > INVENTORY_UPLOAD_MAX_BYTES) return setError(`The file is larger than ${INVENTORY_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
    if (!/\.(xlsx|csv)$/i.test(chosen.name)) return setError("Choose an .xlsx workbook or a .csv file.");
    setBusy("checking");
    setError(null);
    setResult(null);
    const body = new FormData();
    body.append("file", chosen);
    if (override) body.append("mapping", JSON.stringify(override));
    if (sheetName) body.append("sheetName", sheetName);
    if (sourceReference.trim()) body.append("sourceReference", sourceReference.trim());
    if (sourceLicense.trim()) body.append("sourceLicense", sourceLicense.trim());
    body.append("markAsTestData", String(markAsTestData));
    try {
      // A new preview supersedes the previous one (which is cancelled so it never lingers as pending).
      if (preview) void apiFetch(`${BASE}/${preview.jobId}/${P.cancel}`, { method: "POST" }).catch(() => undefined);
      const next = await apiFetch<InventoryUploadPreviewDto>(`${BASE}/${P.preview}`, { method: "POST", body });
      setPreview(next);
      setMapping(next.mapping);
    } catch (err) {
      setPreview(null);
      setError(errorText(err, "The file could not be checked."));
    } finally {
      setBusy("");
    }
  }

  function choose(chosen: File | null) {
    setFile(chosen);
    setPreview(null);
    setMapping(null);
    setResult(null);
    if (chosen) void runPreview(chosen, null);
  }

  async function confirm() {
    if (!preview) return;
    setBusy("importing");
    setError(null);
    try {
      const job = await apiFetch<InventoryUploadJobDto>(`${BASE}/${preview.jobId}/${P.commit}`, { method: "POST" });
      setResult(job);
      setPreview(null);
    } catch (err) {
      setError(errorText(err, "Nothing was imported."));
    } finally {
      setBusy("");
    }
  }

  async function cancel() {
    if (!preview) return;
    setBusy("cancelling");
    try {
      await apiFetch(`${BASE}/${preview.jobId}/${P.cancel}`, { method: "POST" });
    } catch {
      /* already gone */
    }
    setBusy("");
    setPreview(null);
    setFile(null);
  }

  const importable = preview ? preview.summary.createGlobal + preview.summary.createShop + preview.summary.linkShop : 0;
  const rows = (preview?.rows ?? []).filter((r) =>
    filter === "ALL" ? true : filter === "PROBLEMS" ? r.issues.length > 0 || r.action === "REVIEW" || r.action === "SKIP" : r.action === filter,
  );

  return (
    <main className={ui.grid} aria-labelledby="upload-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Inventory Management</div>
          <h1 id="upload-title" className={ui.pageTitle}>Upload inventory</h1>
          <p className={ui.pageSub}>
            Add products to the FastQue master catalog from Excel (.xlsx) or CSV. Rows without a shop become <strong>global</strong> products every salon can add; rows with a shop name or ID are linked to that existing shop only. Nothing becomes stock in a shop by itself, and shops are never created by an upload.
          </p>
        </div>
        <button type="button" className={css.tab} onClick={() => void download(`${BASE}/${P.template}`, "fastque-inventory-template.csv")}>Download template</button>
      </div>

      {!canManage && <p className={`${ui.banner} ${ui.bannerError}`}>Only platform admins and co-founders can upload products.</p>}

      {canManage && !preview && !result && (
        <section className={ui.card} aria-label="Choose file">
          <div
            className={`${css.dropZone} ${dragOver ? css.dropZoneOn : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              choose(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <button type="button" className={`${css.verify} ${css.bigButton}`} onClick={() => input.current?.click()} disabled={!!busy}>
              {busy === "checking" ? "Checking file…" : "Upload Product Database"}
            </button>
            <p className={ui.hint}>or drop an .xlsx / .csv file here · up to {INVENTORY_UPLOAD_MAX_BYTES / 1024 / 1024} MB and 5,000 rows</p>
            <input
              ref={input}
              type="file"
              hidden
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => {
                choose(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
          <div className={`${ui.rowWrap} ${css.importForm}`}>
            <label className={css.field}>
              <span className={ui.label}>Where the data came from (optional)</span>
              <input className={ui.input} maxLength={300} value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="e.g. Distributor price list, Nov 2026" />
            </label>
            <label className={css.field}>
              <span className={ui.label}>Licence / permission (optional)</span>
              <input className={ui.input} maxLength={80} value={sourceLicense} onChange={(e) => setSourceLicense(e.target.value)} placeholder="e.g. Supplied by distributor" />
            </label>
            <label className={css.checkField}>
              <input type="checkbox" checked={markAsTestData} onChange={(e) => setMarkAsTestData(e.target.checked)} />
              <span>This file is test / sample data</span>
            </label>
          </div>
          <p className={ui.hint}>
            Column names are matched flexibly (e.g. EAN, Barcode, Barcode Number → barcode; Salon Name, Shop Name → shop). Rows whose “Data status” says test/fake/sample are marked as test data automatically.
          </p>
        </section>
      )}

      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}

      {preview && (
        <>
          <section className={ui.card} aria-label="Upload preview">
            <div className={ui.cardHead}>
              <div>
                <h2 className={ui.cardTitle}>Preview: {preview.fileName}</h2>
                <div className={ui.cardSub}>
                  {preview.fileType}
                  {preview.sheetName ? ` · sheet “${preview.sheetName}”` : ""} · header on row {preview.headerRow} · {preview.summary.totalRows} product rows · nothing has been saved yet
                </div>
              </div>
              {preview.sheets.length > 1 && file && (
                <label className={css.field} style={{ maxWidth: 220 }}>
                  <span className={ui.label}>Sheet</span>
                  <select className={ui.input} value={preview.sheetName ?? ""} onChange={(e) => void runPreview(file, null, e.target.value)}>
                    {preview.sheets.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className={css.summaryGrid}>
              <Stat label="New global products" value={preview.summary.createGlobal} tone="ok" />
              <Stat label="New shop-only products" value={preview.summary.createShop} tone="ok" />
              <Stat label="Added to a shop" value={preview.summary.linkShop} tone="ok" />
              <Stat label="Already in catalog" value={preview.summary.unchanged} />
              <Stat label="Needs review" value={preview.summary.review} tone={preview.summary.review ? "warn" : undefined} />
              <Stat label="Rows with errors" value={preview.summary.errors} tone={preview.summary.errors ? "bad" : undefined} />
              <Stat label="Warnings" value={preview.summary.warnings} />
              <Stat label="Global / shop rows" value={`${preview.summary.globalRows} / ${preview.summary.shopRows}`} />
            </div>
            {preview.fileWarnings.length > 0 && (
              <ul className={css.notes}>
                {preview.fileWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {preview.testDataInProductionBlocked && preview.rows.some((r) => r.isTestData) && (
              <p className={`${ui.banner} ${ui.bannerError}`}>This is production: test/sample rows are held for review and will not be imported.</p>
            )}
            <div className={`${ui.rowWrap} ${css.mt}`}>
              <button type="button" className={css.verify} onClick={() => void confirm()} disabled={!!busy || importable === 0}>
                {busy === "importing" ? "Importing…" : importable ? `Confirm import (${importable} row${importable === 1 ? "" : "s"})` : "Nothing new to import"}
              </button>
              <button type="button" className={css.tab} onClick={() => void download(`${BASE}/${preview.jobId}/${P.errorReport}`, "row-report.csv")}>Download row report</button>
              <button type="button" className={css.tab} onClick={() => void cancel()} disabled={!!busy}>Cancel</button>
            </div>
          </section>

          <section className={ui.card} aria-label="Column mapping">
            <h2 className={ui.cardTitle}>Columns</h2>
            <p className={ui.cardSub}>Detected automatically. Change a column and the file is checked again.</p>
            <div className={css.mappingGrid}>
              {preview.headers.map((header, col) => (
                <label key={`${header}-${col}`} className={css.field}>
                  <span className={ui.label}>{header || `Column ${col + 1}`}</span>
                  <select
                    className={ui.input}
                    value={mapping?.[col] ?? ""}
                    disabled={!!busy}
                    onChange={(e) => {
                      const next = [...(mapping ?? preview.mapping)];
                      const value = (e.target.value || null) as UploadField | null;
                      next.forEach((f, i) => {
                        if (value && f === value && i !== col) next[i] = null;
                      });
                      next[col] = value;
                      setMapping(next);
                      if (file) void runPreview(file, next, preview.sheetName);
                    }}
                  >
                    <option value="">— ignore —</option>
                    {UPLOAD_FIELDS.map((f) => (
                      <option key={f} value={f}>{UPLOAD_FIELD_LABELS[f]}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className={ui.card} aria-label="Rows">
            <div className={ui.cardHead}>
              <h2 className={ui.cardTitle}>Rows</h2>
              <div className={ui.rowWrap}>
                {(["ALL", "PROBLEMS", "CREATE_GLOBAL", "CREATE_SHOP", "LINK_SHOP", "UNCHANGED", "REVIEW"] as const).map((f) => (
                  <button key={f} type="button" className={`${css.tab} ${filter === f ? css.tabOn : ""}`} onClick={() => setFilter(f)}>
                    {f === "ALL" ? "All" : f === "PROBLEMS" ? "Errors & warnings" : ACTION_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr><th>Row</th><th>Barcode</th><th>Product</th><th>Shop</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className={ui.num}>{r.rowNumber}</td>
                      <td>
                        {r.barcode ?? "—"}
                        {r.symbology && <div className={ui.cardSub}>{r.symbology}</div>}
                      </td>
                      <td>
                        <strong>{r.name ?? "—"}</strong>
                        <div className={ui.cardSub}>{[r.brand, r.variant, r.category, r.productRef].filter(Boolean).join(" · ")}{r.isTestData ? " · TEST DATA" : ""}</div>
                      </td>
                      <td>{r.shop ? r.shop.name : r.shopText ? <em>{r.shopText}</em> : "Global"}</td>
                      <td>
                        <span className={`${css.status} ${ACTION_TONE[r.action]}`}>{ACTION_LABEL[r.action]}</span>
                        {r.issues.map((i, n) => (
                          <div key={n} className={i.severity === "WARNING" ? css.rowWarn : css.rowErrors}>
                            {i.severity === "REVIEW" ? "Review: " : i.severity === "WARNING" ? "Note: " : ""}
                            {i.message}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.summary.totalRows > preview.rows.length && <p className={ui.hint}>Showing the first {preview.rows.length} of {preview.summary.totalRows} rows. Download the row report for every problem.</p>}
          </section>
        </>
      )}

      {result && (
        <section className={ui.card} aria-label="Import result" role="status">
          <h2 className={ui.cardTitle}>{STATUS_LABEL[result.status]}: {result.fileName}</h2>
          <div className={css.summaryGrid}>
            <Stat label="Products created" value={result.createdCount} tone="ok" />
            <Stat label="Shop links added" value={result.linkedCount} tone="ok" />
            <Stat label="Already there" value={result.unchangedCount} />
            <Stat label="Skipped" value={result.skippedCount} />
            <Stat label="Needs review" value={result.reviewCount} tone={result.reviewCount ? "warn" : undefined} />
            <Stat label="Errors" value={result.errorCount} tone={result.errorCount ? "bad" : undefined} />
          </div>
          <div className={`${ui.rowWrap} ${css.mt}`}>
            <Link className={css.verify} href="/dashboard/admin/inventory/catalog?status=VERIFIED">Open Product Master</Link>
            <button type="button" className={css.tab} onClick={() => void download(`${BASE}/${result.id}/${P.errorReport}`, "row-report.csv")}>Download row report</button>
            <button type="button" className={css.tab} onClick={() => choose(null)}>Upload another file</button>
          </div>
        </section>
      )}

      <UploadHistory refreshKey={result?.id ?? ""} />
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`${css.stat} ${tone ? css[`stat_${tone}`] : ""}`}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
    </div>
  );
}

/** Upload History: every file uploaded, its outcome, and its row-by-row report. */
export function UploadHistory({ refreshKey, standalone }: { refreshKey?: string; standalone?: boolean }) {
  const [items, setItems] = useState<InventoryUploadJobDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after: string | null) => {
    try {
      const page = await apiFetch<InventoryPageDto<InventoryUploadJobDto>>(`${BASE}?limit=20${after ? `&cursor=${after}` : ""}`);
      setItems((prev) => (after && prev ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load the upload history."));
    }
  }, []);
  useEffect(() => {
    apiFetch<InventoryPageDto<InventoryUploadJobDto>>(`${BASE}?limit=20`)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((err) => setError(errorText(err, "Could not load the upload history.")));
  }, [refreshKey]);

  const body = (
    <section className={ui.card} aria-label="Upload history">
      <h2 className={ui.cardTitle}>Upload history</h2>
      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
      {!items ? (
        <div className={`${ui.skeleton} ${css.skeletonSmall}`} />
      ) : items.length === 0 ? (
        <p className={ui.hint}>No files uploaded yet.</p>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>Uploaded</th><th>File</th><th>Status</th><th className={ui.num}>Rows</th><th className={ui.num}>Created</th><th className={ui.num}>Shop links</th><th className={ui.num}>Review / errors</th><th><span className={ui.srOnly}>Details</span></th></tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <HistoryRow key={j.id} job={j} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <button type="button" className={`${css.tab} ${css.more}`} onClick={() => void load(cursor)}>Load more</button>}
    </section>
  );
  if (!standalone) return body;
  return (
    <main className={ui.grid} aria-labelledby="history-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Inventory Management</div>
          <h1 id="history-title" className={ui.pageTitle}>Upload history</h1>
          <p className={ui.pageSub}>Every product file uploaded to the master catalog, what it changed, and a downloadable report of each row’s problems.</p>
        </div>
        <Link className={css.verify} href="/dashboard/admin/inventory/upload">Upload Product Database</Link>
      </div>
      {body}
    </main>
  );
}

function HistoryRow({ job, open, onToggle }: { job: InventoryUploadJobDto; open: boolean; onToggle: () => void }) {
  const [issues, setIssues] = useState<{ items: InventoryUploadIssueDto[]; total: number; page: number } | null>(null);
  useEffect(() => {
    if (!open || issues) return;
    void apiFetch<{ items: InventoryUploadIssueDto[]; total: number; page: number }>(`${BASE}/${job.id}/${P.issues}?limit=100`).then(setIssues).catch(() => setIssues({ items: [], total: 0, page: 1 }));
  }, [open, issues, job.id]);
  return (
    <>
      <tr>
        <td>{new Date(job.createdAt).toLocaleString()}<div className={ui.cardSub}>{job.uploadedBy.email ?? ""}</div></td>
        <td>{job.fileName}<div className={ui.cardSub}>{job.sheetName ?? job.fileType}{job.markAsTestData ? " · test data" : ""}</div></td>
        <td>{STATUS_LABEL[job.status]}{job.failureMessage && <div className={css.rowErrors}>{job.failureMessage}</div>}</td>
        <td className={ui.num}>{job.totalRows}</td>
        <td className={ui.num}>{job.createdCount}</td>
        <td className={ui.num}>{job.linkedCount}</td>
        <td className={ui.num}>{job.reviewCount} / {job.errorCount}</td>
        <td className={css.actions}>
          <button type="button" className={ui.cardLink} onClick={onToggle} aria-expanded={open}>{open ? "Hide" : "Rows"}</button>
          <button type="button" className={ui.cardLink} onClick={() => void download(`${BASE}/${job.id}/${P.errorReport}`, "row-report.csv")}>CSV</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8}>
            {!issues ? (
              "Loading…"
            ) : issues.total === 0 ? (
              <span className={ui.hint}>No row problems.</span>
            ) : (
              <ul className={css.notes}>
                {issues.items.map((i) => (
                  <li key={i.id} className={i.severity === "WARNING" ? css.rowWarn : css.rowErrors}>
                    Row {i.rowNumber} · {i.severity.toLowerCase()} · {i.message}
                  </li>
                ))}
                {issues.total > issues.items.length && <li>…and {issues.total - issues.items.length} more in the CSV report.</li>}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
