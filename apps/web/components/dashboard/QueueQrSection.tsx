"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { PublicQueueQrDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

// Owner-approved FastQue FQ mark embedded as a data URI so the branded centre survives not only
// the live dashboard render but also downloaded/printed SVGs without relying on an external asset
// URL. Kept deliberately small and semi-transparent inside a high-error-correction QR so it reads
// as part of the code rather than as a pasted-on sticker.
const FASTQUE_QR_MARK_DATA_URI = "data:image/png;base64,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";

/**
 * Owner/staff-only "Customer Queue QR" panel — GET dashboard/salons/:salonId/queue-qr is
 * authorization-protected the same way every other dashboard salon endpoint is
 * (SalonAccessService.assertAccess), so this can only ever show the calling user's own salon's
 * QR. The QR itself is rendered entirely client-side from the plain publicQueueUrl string the
 * backend returns — no server-side image generation, no per-render cost.
 */
export function QueueQrSection({ salonId, salonName }: { salonId: string; salonName: string }) {
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

  function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      const entity: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      };
      return entity[char] ?? char;
    });
  }

  function handleDownload() {
    const svg = svgWrapperRef.current?.querySelector("svg");
    if (!svg) return;

    const safeName = escapeXml(salonName);
    const nameFontSize = Math.max(13, 20 - Math.floor(Math.max(0, salonName.length - 18) / 3));
    const posterSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="260" height="330" viewBox="0 0 260 330">
        <rect width="260" height="330" rx="20" fill="#ffffff" />
        <text x="130" y="34" text-anchor="middle" font-family="Arial, sans-serif" font-size="${nameFontSize}" font-weight="700" fill="#1C1A17">${safeName}</text>
        <text x="130" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#6B6257">Scan to join the queue</text>
        <g transform="translate(30 72)">${svg.outerHTML}</g>
        <text x="130" y="300" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#a8791f">FastQue</text>
      </svg>`;

    const blob = new Blob([posterSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${salonName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fastque"}-queue-qr.svg`;
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
          <div
            ref={svgWrapperRef}
            className={styles.qrBox}
            style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}
          >
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1C1A17", textAlign: "center" }}>
              {salonName}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#6B6257", textAlign: "center" }}>
              Scan to join the queue
            </p>
            <QRCodeSVG
              value={qr.publicQueueUrl}
              size={200}
              level="H"
              fgColor="#4A3125"
              bgColor="#ffffff"
              imageSettings={{
                src: FASTQUE_QR_MARK_DATA_URI,
                width: 44,
                height: 33,
                excavate: true,
                opacity: 0.84,
              }}
            />
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#a8791f", textAlign: "center" }}>
              FastQue
            </p>
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
