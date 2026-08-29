"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_PATHS, VerificationStatus } from "@barbercue/shared";
import type { AdminVerificationRequestDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button } from "../../../../../components/ui/Button";
import styles from "../admin.module.css";

const STATUS_FILTERS = ["ALL", ...Object.values(VerificationStatus)] as const;

function basePath(): string {
  return `${ADMIN_PATHS.admin}/${ADMIN_PATHS.verification}`;
}

function subjectLabel(item: AdminVerificationRequestDto): string {
  if (item.subjectType === "SHOP") return item.salonName ?? "Unknown shop";
  return `${item.staffDisplayName ?? "Unknown barber"} — ${item.staffSalonName ?? "Unknown shop"}`;
}

function RequestRow({
  item,
  onUpdated,
}: {
  item: AdminVerificationRequestDto;
  onUpdated: (updated: AdminVerificationRequestDto) => void;
}) {
  const [reviewNotes, setReviewNotes] = useState(item.reviewNotes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startReview() {
    setBusy("start");
    setError(null);
    try {
      const updated = await apiFetch<AdminVerificationRequestDto>(
        `${basePath()}/${item.id}/${ADMIN_PATHS.startReview}`,
        { method: "POST" },
      );
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start review.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (decision === "REJECTED" && !reviewNotes.trim()) {
      setError("A reason is required when rejecting a request.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const updated = await apiFetch<AdminVerificationRequestDto>(`${basePath()}/${item.id}/${ADMIN_PATHS.decide}`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewNotes: reviewNotes.trim() || undefined }),
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this decision.");
    } finally {
      setBusy(null);
    }
  }

  const decided = item.status === "APPROVED" || item.status === "REJECTED";

  return (
    <tr>
      <td>
        <strong>{subjectLabel(item)}</strong>
        <small>{item.subjectType} · {item.submitterEmail ?? item.submitterPhone ?? "No contact on file"}</small>
      </td>
      <td>
        {item.evidenceNotes && <p style={{ margin: "0 0 4px" }}>{item.evidenceNotes}</p>}
        {item.evidenceUrls.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {item.evidenceUrls.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url}</a>
              </li>
            ))}
          </ul>
        )}
        {!item.evidenceNotes && item.evidenceUrls.length === 0 && <span>—</span>}
      </td>
      <td>{new Date(item.submittedAt).toLocaleString()}</td>
      <td><strong>{item.status}</strong></td>
      <td>
        {error && <p role="alert" style={{ color: "var(--bc-accent)", fontSize: 12, margin: "0 0 6px" }}>{error}</p>}
        {decided ? (
          <span style={{ fontSize: 12, color: "var(--bc-muted)" }}>{item.reviewNotes ?? "No notes"}</span>
        ) : (
          <>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Review notes (required to reject)"
              rows={2}
              style={{ width: "100%", marginBottom: 6, padding: 6, borderRadius: 6, border: "1px solid var(--bc-border)", fontSize: 12 }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {item.status === "SUBMITTED" && (
                <Button type="button" variant="outline" onClick={() => void startReview()} disabled={busy !== null}>
                  {busy === "start" ? "Starting…" : "Start review"}
                </Button>
              )}
              <Button type="button" onClick={() => void decide("APPROVED")} disabled={busy !== null}>
                {busy === "APPROVED" ? "Saving…" : "Approve"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void decide("REJECTED")} disabled={busy !== null}>
                {busy === "REJECTED" ? "Saving…" : "Reject"}
              </Button>
            </div>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * PLATFORM_ADMIN review queue for Shop / Barber Verification (Phase 18). Every APPROVED/REJECTED
 * outcome is this admin's own explicit decision — there is no automated approval path, and
 * rejecting always requires a reason so the owner knows what to fix before resubmitting.
 */
export default function AdminVerificationPage() {
  const [items, setItems] = useState<AdminVerificationRequestDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("SUBMITTED");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    (filter: (typeof STATUS_FILTERS)[number], cursor: string | undefined, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      const params = new URLSearchParams({ limit: "20" });
      if (filter !== "ALL") params.set("status", filter);
      if (cursor) params.set("cursor", cursor);
      return apiFetch<PaginatedResult<AdminVerificationRequestDto>>(`${basePath()}?${params}`)
        .then((result) => {
          setItems((prev) => (append ? [...prev, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load the verification queue."))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadPage(statusFilter, undefined, false));
  }, [loadPage, statusFilter]);

  function handleUpdated(updated: AdminVerificationRequestDto) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Role-protected operations</p>
          <h1>Verification queue</h1>
          <p>
            Manual review only — evidence reviewed by a human admin, never automated. Rejecting always
            requires a reason.
          </p>
        </div>
      </header>

      <section className={styles.filters} aria-label="Queue filters">
        <div>
          <label htmlFor="status-filter">Status</label>
          <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading && <p className={styles.loading} role="status">Loading…</p>}

      {!loading && items.length === 0 && !error && (
        <p className={styles.loading}>No requests in this filter.</p>
      )}

      {items.length > 0 && (
        <section className={styles.section}>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Evidence</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <RequestRow key={item.id} item={item} onUpdated={handleUpdated} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {nextCursor && (
        <Button type="button" variant="outline" onClick={() => void loadPage(statusFilter, nextCursor, true)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </main>
  );
}
