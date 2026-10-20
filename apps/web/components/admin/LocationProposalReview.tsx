"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_PATHS } from "@barbercue/shared";
import type { AdminSalonLocationProposalDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { formatCoordinates, formatReviewTime, mapLinkOut, sourceLabel } from "../../lib/location-proposal";
import { addressLine, decisionBody, decisionVerb, describeShift, validateNote, NOTE_MAX, type Decision } from "../../lib/location-review";
import { Button } from "../ui/Button";
import styles from "../../app/(dashboard)/dashboard/admin/admin.module.css";

const BASE = `${ADMIN_PATHS.admin}/${ADMIN_PATHS.locationVerifications}`;

function ProposalRow({ item, onDecided }: { item: AdminSalonLocationProposalDto; onDecided: (id: string, decision: Decision) => void }) {
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteProblem = validateNote(note);

  async function decide(decision: Decision) {
    const problem = validateNote(note);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<unknown>(`${BASE}/${item.id}/${ADMIN_PATHS.decision}`, { method: "POST", body: JSON.stringify(decisionBody(decision, note)) });
      onDecided(item.id, decision);
    } catch (err) {
      // The server is the authority (a different global administrator, an undecided proposal): its message is shown as is.
      setError(err instanceof ApiError ? err.message : "Could not save this decision. Nothing was changed.");
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  const current = item.salon.currentLatitude !== null && item.salon.currentLongitude !== null ? { latitude: item.salon.currentLatitude, longitude: item.salon.currentLongitude } : null;

  return (
    <tr>
      <td>
        <strong>{item.salon.name}</strong>
        <small>{item.salon.publicId}</small>
        <small>{addressLine(item.salon)}</small>
      </td>
      <td>
        <strong>{formatCoordinates(item.latitude, item.longitude)}</strong>
        <small>{sourceLabel(item.source)}: how it was entered, not proof of position</small>
        <small>{describeShift(item)}</small>
        <small>
          <a href={mapLinkOut(item.latitude, item.longitude)} target="_blank" rel="noopener noreferrer">Proposed point on a map</a>
          {current && <> · <a href={mapLinkOut(current.latitude, current.longitude)} target="_blank" rel="noopener noreferrer">Current point on a map</a></>}
        </small>
      </td>
      <td>{formatReviewTime(item.submittedAt)}</td>
      <td>
        {error && <p role="alert" style={{ color: "#ffb7c9", fontSize: 12, margin: "0 0 6px" }}>{error}</p>}
        <label htmlFor={`note-${item.id}`} style={{ fontSize: 12 }}>Review note (required, shown to the owner)</label>
        <textarea
          id={`note-${item.id}`}
          value={note}
          onChange={(e) => { setNote(e.target.value); setConfirming(null); }}
          rows={2}
          maxLength={NOTE_MAX}
          style={{ width: "100%", margin: "4px 0 6px", padding: 6, borderRadius: 6, border: "1px solid #3a3a48", background: "#0d0d12", color: "#f7f7fb", fontSize: 12 }}
        />
        {confirming ? (
          <div role="group" aria-label="Confirm decision">
            <p style={{ fontSize: 12, margin: "0 0 6px" }}>
              {confirming === "APPROVED"
                ? "Approving makes these coordinates the shop's public location for distances and maps."
                : "Rejecting keeps the current public location and tells the owner why."}
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Button type="button" onClick={() => void decide(confirming)} disabled={busy}>{busy ? "Saving…" : `Yes, ${decisionVerb(confirming).toLowerCase()}`}</Button>
              <Button type="button" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>Back</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button type="button" onClick={() => setConfirming("APPROVED")} disabled={busy || noteProblem !== null}>Approve</Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming("REJECTED")} disabled={busy || noteProblem !== null}>Reject</Button>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Platform-admin queue for owner-proposed shop locations. A decision needs a note and an explicit confirmation, and the
 * server decides who may decide (a different global administrator than the proposer). Nothing here changes a public
 * location by itself.
 */
export function LocationProposalReview() {
  const [items, setItems] = useState<AdminSalonLocationProposalDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    if (cursor) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const page = await apiFetch<PaginatedResult<AdminSalonLocationProposalDto>>(`${BASE}?${params}`);
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the location queue.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load(null));
  }, [load]);

  function decided(id: string, decision: Decision) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setNotice(decision === "APPROVED" ? "Approved. The shop's public location now uses the proposed point." : "Rejected. The public location is unchanged and the owner can see your note.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Role-protected operations</p>
          <h1>Shop location proposals</h1>
          <p>
            Owners propose where their shop is; nothing is public until a global administrator other than the proposer approves it. Check each point on a map against the address. How a proposal was entered (device location or typed) is not proof of position.
          </p>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <div role="status" aria-live="polite">{notice && <p className={styles.loading}>{notice}</p>}</div>
      {loading && <p className={styles.loading} role="status">Loading…</p>}
      {!loading && items.length === 0 && !error && <p className={styles.loading}>No proposals are waiting for review.</p>}

      {items.length > 0 && (
        <section className={styles.section}>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr><th>Shop</th><th>Proposed location</th><th>Sent</th><th>Decision</th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ProposalRow key={item.id} item={item} onDecided={decided} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {nextCursor && (
        <Button type="button" variant="outline" onClick={() => void load(nextCursor)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </main>
  );
}
