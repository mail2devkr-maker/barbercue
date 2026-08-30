"use client";

import { use, useEffect, useState } from "react";
import { DASHBOARD_PATHS, VERIFICATION_BADGE_CAPTION } from "@barbercue/shared";
import type { VerificationRequestDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button } from "../../../../../../components/ui/Button";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

function verificationPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.verification}`;
}

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: "Submitted — waiting for a BarberCue admin to review it.",
  UNDER_REVIEW: "Currently under review by a BarberCue admin.",
  APPROVED: "Approved. The Verified badge now shows on your shop's public profile.",
  REJECTED: "Not approved. Review the notes below, then resubmit with clearer evidence.",
};

/**
 * Owner-side Shop Verification (Phase 18 foundation) — submit evidence for manual admin review.
 * No document upload (no object storage configured); evidence is free text plus already-hosted
 * https links, same convention as Salon photos. See VERIFICATION_BADGE_CAPTION for the exact
 * wording shown wherever the resulting badge appears — never "Identity Verified."
 */
export default function DashboardVerificationPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const [current, setCurrent] = useState<VerificationRequestDto | null | undefined>(undefined);
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [evidenceUrlsText, setEvidenceUrlsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<VerificationRequestDto | null>(verificationPath(salonId))
      .then((result) => {
        if (!cancelled) setCurrent(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load verification status.");
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  async function submit() {
    setError(null);
    const evidenceUrls = evidenceUrlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    setSubmitting(true);
    try {
      const result = await apiFetch<VerificationRequestDto>(verificationPath(salonId), {
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
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Shop verification</h1>
      <p className={styles.pageSubtitle}>{VERIFICATION_BADGE_CAPTION}</p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {current === undefined && !error && <p className={styles.loadingText}>Loading…</p>}

      {current !== undefined && current !== null && (
        <div className={`${styles.banner} ${current.status === "APPROVED" ? styles.bannerNotice : styles.bannerWarning}`} style={{ margin: "16px 0" }}>
          <strong>{current.status}</strong>
          <p style={{ margin: "4px 0 0" }}>{STATUS_COPY[current.status]}</p>
          {current.reviewNotes && <p style={{ margin: "4px 0 0" }}><strong>Admin notes:</strong> {current.reviewNotes}</p>}
        </div>
      )}

      {current !== undefined && canSubmit && (
        <div style={{ marginTop: 16 }}>
          <div className={styles.fieldWrap} style={{ marginBottom: 10 }}>
            <label className={styles.fieldLabel} htmlFor="evidence-notes">Evidence notes</label>
            <textarea
              id="evidence-notes"
              value={evidenceNotes}
              onChange={(e) => setEvidenceNotes(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Describe what proves this is a real, operating shop — business registration, GST, shop-front photos, utility bill, etc."
              className={styles.input}
            />
          </div>
          <div className={styles.fieldWrap} style={{ marginBottom: 10 }}>
            <label className={styles.fieldLabel} htmlFor="evidence-urls">Evidence links (one per line, https only)</label>
            <textarea
              id="evidence-urls"
              value={evidenceUrlsText}
              onChange={(e) => setEvidenceUrlsText(e.target.value)}
              rows={3}
              placeholder={"https://example.com/registration.jpg\nhttps://example.com/shop-front.jpg"}
              className={styles.input}
            />
            <p className={styles.hint}>Link already-hosted photos or documents — a link to Google Business, Instagram, or any https image works.</p>
          </div>
          <Button type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Submitting…" : current ? "Resubmit for review" : "Submit for review"}
          </Button>
        </div>
      )}
    </main>
  );
}
