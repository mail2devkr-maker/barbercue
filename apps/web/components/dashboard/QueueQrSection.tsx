"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { PublicQueueQrDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";

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
      <section style={{ marginTop: 24 }}>
        <p style={{ color: "#B0413E" }}>{error}</p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid #E7E0D3" }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Customer Queue QR</h2>
      <p style={{ color: "#6B6357", fontSize: 14, marginBottom: 16 }}>
        Customers can scan this QR code at your shop to join the queue.
      </p>

      {!qr ? (
        <p style={{ color: "#6B6357" }}>Loading…</p>
      ) : (
        <>
          <div ref={svgWrapperRef} style={{ background: "#fff", padding: 16, borderRadius: 8, display: "inline-block", border: "1px solid #E7E0D3" }}>
            <QRCodeSVG value={qr.publicQueueUrl} size={200} level="M" />
          </div>

          <p style={{ marginTop: 12, marginBottom: 4, fontSize: 13, color: "#6B6357" }}>Public queue URL</p>
          <p style={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", marginBottom: 12 }}>
            {qr.publicQueueUrl}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void handleCopy()}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #E7E0D3", background: "#fff", cursor: "pointer" }}
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #E7E0D3", background: "#fff", cursor: "pointer" }}
            >
              Download QR
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #E7E0D3", background: "#fff", cursor: "pointer" }}
            >
              Print
            </button>
          </div>
        </>
      )}
    </section>
  );
}
