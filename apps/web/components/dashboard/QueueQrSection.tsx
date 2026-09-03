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
            <QRCodeSVG value={qr.publicQueueUrl} size={200} level="M" fgColor="#a8791f" bgColor="#ffffff" />
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
