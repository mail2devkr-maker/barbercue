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
const QR_GOLD = "#FFE15C";
const QR_MAGENTA = "#F20A83";
const QR_BG = "#000000";

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
    const nameFontSize = Math.max(13, 27 - Math.floor(Math.max(0, salonName.length - 20) / 2));

    // Keep the exported/printed artwork self-contained. The live QR uses normal public assets,
    // while the downloaded SVG embeds those exact images as data URIs.
    const [markDataUri, logoDataUri] = await Promise.all([
      imageToDataUri(FASTQUE_QR_MARK_SRC),
      imageToDataUri(FASTQUE_LOGO_SRC),
    ]);
    // The on-screen responsive SVG has width:100%; height:auto. That CSS is not
    // valid for a nested SVG in an exported standalone 4x6in document (some
    // renderers leave the printable QR blank). Clone without responsive CSS and
    // set deterministic pixel dimensions before embedding the real QR vector.
    const printableQr = svg.cloneNode(true) as SVGSVGElement;
    printableQr.removeAttribute("style");
    printableQr.setAttribute("width", "200");
    printableQr.setAttribute("height", "200");
    const brandedQrSvg = printableQr.outerHTML
      .replaceAll(`${window.location.origin}${FASTQUE_QR_MARK_SRC}`, markDataUri)
      .replaceAll(FASTQUE_QR_MARK_SRC, markDataUri);

    // Consistent FastQue 4×6-inch premium stand for every salon, including existing salons.
    // This is an actual encoded QR SVG, not an image-generated/decorative QR mockup.
    // Keep the SAME existing token from the backend. Gold on black requires real-device
    // camera/printed scan acceptance before production exposure.
    const posterSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="4in" height="6in" viewBox="0 0 400 600">
        <defs>
          <linearGradient id="shopNameGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#FFE15C" />
            <stop offset="52%" stop-color="#FFC65B" />
            <stop offset="72%" stop-color="#FF3E57" />
            <stop offset="100%" stop-color="#F20A83" />
          </linearGradient>
        </defs>
        <rect width="400" height="600" rx="22" fill="#000000" />
        <rect x="8" y="8" width="384" height="584" rx="20" fill="none" stroke="#FFE15C" stroke-width="2" />
        <image href="${logoDataUri}" x="110" y="21" width="180" height="53" preserveAspectRatio="xMidYMid meet" />
        <text x="200" y="111" text-anchor="middle" font-family="Arial, sans-serif" font-size="${nameFontSize}" font-weight="800" fill="url(#shopNameGradient)" ${salonName.length > 33 ? 'textLength="360" lengthAdjust="spacingAndGlyphs"' : ""}>${safeName}</text>
        <text x="200" y="150" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#F7F5F4">Scan to join the live queue</text>
        <rect x="24" y="178" width="352" height="350" rx="15" fill="#000000" stroke="#F20A83" stroke-width="4"/>
        <g transform="translate(48 199) scale(1.52)">${brandedQrSvg}</g>
        <text x="200" y="561" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="800" fill="#F20A83">SCAN &#8226; JOIN &#8226; GET YOUR TURN</text>
        <text x="200" y="585" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#C9C3C4">Powered by FastQue</text>
      </svg>`;
    const blob = new Blob([posterSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${salonName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fastque"}-queue-qr-4x6in.svg`;
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
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              boxSizing: "border-box", width: "min(100%, 400px)", padding: "16px 18px 14px",
              borderRadius: 22, border: `2px solid ${QR_GOLD}`, backgroundColor: QR_BG, gap: 12,
            }}
          >
            <img src={FASTQUE_LOGO_SRC} alt="FastQue" width={180} height={53} style={{ objectFit: "contain", maxWidth: "100%" }} />
            <p style={{ margin: 0, fontSize: "clamp(16px, 3vw, 27px)", fontWeight: 800, lineHeight: 1.2, textAlign: "center",
              overflowWrap: "anywhere", background: `linear-gradient(90deg, ${QR_GOLD}, #FF3E57, ${QR_MAGENTA})`,
              WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: QR_GOLD,
            }}>{salonName}</p>
            <p style={{ margin: 0, fontSize: 15, color: "#F7F5F4", textAlign: "center" }}>Scan to join the live queue</p>
            <div style={{ width: "100%", padding: 10, border: `4px solid ${QR_MAGENTA}`, backgroundColor: QR_BG, borderRadius: 16, boxSizing: "border-box" }}>
              <QRCodeSVG
                aria-label={`Join ${salonName} Live Queue QR code`}
                value={qr.publicQueueUrl}
                size={200}
                style={{ display: "block", width: "100%", height: "auto" }}
                level="H"
                marginSize={4}
                fgColor={QR_GOLD}
                bgColor={QR_BG}
                imageSettings={{
                  src: FASTQUE_QR_MARK_SRC, width: 46, height: 34, excavate: true, opacity: 1,
                }}
              />
            </div>
            <p style={{ margin: 0, fontSize: "clamp(12px, 2.5vw, 17px)", fontWeight: 800, color: QR_MAGENTA, textAlign: "center" }}>SCAN • JOIN • GET YOUR TURN</p>
            <p style={{ margin: 0, color: "#C9C3C4", fontSize: 12 }}>Powered by FastQue</p>
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
