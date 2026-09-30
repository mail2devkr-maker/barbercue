"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { PublicQueueQrDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

const FASTQUE_QR_MARK_SRC = "/brand/fastque-clean-mark.png";
const FASTQUE_LOGO_SRC = "/brand/fastque-clean-lockup-transparent.png";

async function imageToDataUri(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load brand asset: ${src}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read brand asset."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

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

  async function handleDownload() {
    const svg = svgWrapperRef.current?.querySelector("svg");
    if (!svg) return;

    const safeName = escapeXml(salonName);
    const nameFontSize = Math.max(13, 20 - Math.floor(Math.max(0, salonName.length - 18) / 3));

    // Keep the exported/printed artwork self-contained. The live QR uses normal public assets,
    // while the downloaded SVG embeds those exact images as data URIs.
    const [markDataUri, logoDataUri] = await Promise.all([
      imageToDataUri(FASTQUE_QR_MARK_SRC),
      imageToDataUri(FASTQUE_LOGO_SRC),
    ]);
    const brandedQrSvg = svg.outerHTML
      .replaceAll(`${window.location.origin}${FASTQUE_QR_MARK_SRC}`, markDataUri)
      .replaceAll(FASTQUE_QR_MARK_SRC, markDataUri);

    const posterSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="280" height="360" viewBox="0 0 280 360">
        <defs>
          <linearGradient id="shopNameGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#FFE3A1" />
            <stop offset="34%" stop-color="#FFB24A" />
            <stop offset="68%" stop-color="#F20A76" />
            <stop offset="100%" stop-color="#FF5A2F" />
          </linearGradient>
        </defs>
        <rect width="280" height="360" rx="22" fill="#111017" />
        <text x="140" y="36" text-anchor="middle" font-family="Arial, sans-serif" font-size="${nameFontSize}" font-weight="700" fill="url(#shopNameGradient)">${safeName}</text>
        <text x="140" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#D6CDC2">Scan to join the queue</text>
        <g transform="translate(40 78)">${brandedQrSvg}</g>
        <image href="${logoDataUri}" x="55" y="298" width="170" height="42" preserveAspectRatio="xMidYMid meet" />
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
            <p
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 800,
                textAlign: "center",
                letterSpacing: "0.01em",
                background: "linear-gradient(90deg, #FFE3A1 0%, #FFB24A 34%, #F20A76 68%, #FF5A2F 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "#FFB24A",
              }}
            >
              {salonName}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#D6CDC2", textAlign: "center" }}>
              Scan to join the queue
            </p>
            <QRCodeSVG
              value={qr.publicQueueUrl}
              size={200}
              level="H"
              fgColor="#A8791F"
              bgColor="#ffffff"
              imageSettings={{
                src: FASTQUE_QR_MARK_SRC,
                width: 46,
                height: 34,
                excavate: true,
                opacity: 1,
              }}
            />
            <img
              src={FASTQUE_LOGO_SRC}
              alt="FastQue"
              width={168}
              height={42}
              style={{ display: "block", objectFit: "contain", marginTop: 4 }}
            />
          </div>

          <p className={styles.hint} style={{ marginBottom: 4 }}>Public queue URL</p>
          <p className={styles.qrUrl} style={{ marginBottom: 12 }}>
            {qr.publicQueueUrl}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="button" variant="outline" onClick={() => void handleCopy()}>
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleDownload()}>
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
