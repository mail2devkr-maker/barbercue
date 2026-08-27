"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { PublicQueueQrDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

/**
 * Owner/staff-only "Customer Queue QR" panel — GET dashboard/salons/:salonId/queue-qr is
 * authorization-protected the same way every other dashboard salon endpoint is
 * (SalonAccessService.assertAccess), so this can only ever show the calling user's own salon's
 * QR. The QR itself is rendered entirely client-side from the plain publicQueueUrl string the
 * backend returns — no server-side image generation, no per-render cost.
 */
export function QueueQrSection({ salonId }: { salonId: string }) {
  const [qr, setQr] = useState<PublicQueueQrDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const svgWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicQueueQrDto>(
      `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.queueQr}`,
    )
      .then((result) => {
        if (!cancelled) setQr(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load the queue QR.");
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  async function handleCopy() {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(qr.publicQueueUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard access denied — the URL is still shown as plain text below */
    }
  }

  function handleDownload() {
    const svg = svgWrapperRef.current?.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "barbercue-queue-qr.svg";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <section className={styles.dividerSection}>
        <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>
      </section>
    );
  }

  return (
    <section className={styles.dividerSection}>
      <h2 className={styles.sectionHeading}>Customer Queue QR</h2>
      <p className={styles.pageSubtitle} style={{ fontSize: 14 }}>
        Customers can scan this QR code at your shop to join the queue.
      </p>

      {!qr ? (
        <p className={styles.loadingText}>Loading…</p>
      ) : (
        <>
          <div ref={svgWrapperRef} className={styles.qrBox}>
            <QRCodeSVG value={qr.publicQueueUrl} size={200} level="M" fgColor="#a8791f" bgColor="#ffffff" />
          </div>

          <p className={styles.hint} style={{ marginBottom: 4 }}>Public queue URL</p>
          <p className={styles.qrUrl} style={{ marginBottom: 12 }}>
            {qr.publicQueueUrl}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="button" variant="outline" onClick={() => void handleCopy()}>
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <Button type="button" variant="outline" onClick={handleDownload}>
              Download QR
            </Button>
            <Button type="button" variant="outline" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
