"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, VERIFICATION_BADGE_CAPTION } from "@barbercue/shared";
import type { VerificationRequestDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

function verificationPath(salonId: string, staffId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${staffId}/${DASHBOARD_PATHS.verification}`;
}

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: "Submitted — waiting for a FastQue admin to review it.",
  UNDER_REVIEW: "Currently under review by a FastQue admin.",
  APPROVED: "Approved — the Verified badge now shows on this barber's public profile.",
  REJECTED: "Not approved. Review the notes below, then resubmit with clearer evidence.",
};

/**
 * Owner-side per-barber Verification (Phase 18 foundation) — same shape as the shop-level page,
 * scoped to one SalonStaff row. Mirrors StaffHoursEditor/StaffProfileEditor's own toggle pattern
 * on the staff roster page.
 */
export function StaffVerificationPanel({ salonId, staffId }: { salonId: string; staffId: string }) {
  const [current, setCurrent] = useState<VerificationRequestDto | null | undefined>(undefined);
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [evidenceUrlsText, setEvidenceUrlsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<VerificationRequestDto | null>(verificationPath(salonId, staffId))
      .then((result) => {
        if (!cancelled) setCurrent(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load verification status.");
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, staffId]);

  async function submit() {
    setError(null);
    const evidenceUrls = evidenceUrlsText.split("\n").map((u) => u.trim()).filter(Boolean);
    setSubmitting(true);
    try {
      const result = await apiFetch<VerificationRequestDto>(verificationPath(salonId, staffId), {
        method: "POST",
        body: JSON.stringify({
          evidenceNotes: evidenceNotes.trim() || undefined,
          evidenceUrls: evidenceUrls.length > 0 ? evidenceUrls : undefined,
        }),
      });
      setCurrent(result);
      setEvidenceNotes("");
      setEvidenceUrlsText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit for verification.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = current === null || current?.status === "REJECTED";

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--bc-border)" }}>
      <p className={styles.hint} style={{ marginBottom: 8 }}>{VERIFICATION_BADGE_CAPTION}</p>
      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {current === undefined && <p className={styles.loadingText}>Loading…</p>}

      {current !== undefined && current !== null && (
        <div className={`${styles.banner} ${current.status === "APPROVED" ? styles.bannerNotice : styles.bannerWarning}`} style={{ marginBottom: 10 }}>
          <strong>{current.status}</strong>
          <p style={{ margin: "4px 0 0" }}>{STATUS_COPY[current.status]}</p>
          {current.reviewNotes && <p style={{ margin: "4px 0 0" }}><strong>Admin notes:</strong> {current.reviewNotes}</p>}
        </div>
      )}

      {current !== undefined && canSubmit && (
        <>
          <textarea
            value={evidenceNotes}
            onChange={(e) => setEvidenceNotes(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What proves this barber's professional background — certificate, prior salon reference, etc."
            className={styles.input}
            style={{ marginBottom: 8 }}
          />
          <textarea
            value={evidenceUrlsText}
            onChange={(e) => setEvidenceUrlsText(e.target.value)}
            rows={2}
            placeholder={"https://example.com/certificate.jpg"}
            className={styles.input}
            style={{ marginBottom: 8 }}
          />
          <Button type="button" variant="outline" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Submitting…" : current ? "Resubmit for review" : "Submit for review"}
          </Button>
        </>
      )}
    </div>
  );
}
