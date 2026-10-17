"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { PaginatedResult, RegisterSalonResultDto, SalonListItemDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { shareOrCopy } from "../../lib/booking-actions";
import {
  INVITE_TEXT_MAX,
  cleanInviteText,
  composeMessage,
  defaultInviteText,
  emailShareUrl,
  facebookShareUrl,
  findOwnListing,
  isShareable,
  publicShopPath,
  whatsappShareUrl,
} from "../../lib/shop-share";
import { Banner, Btn, BtnLink, Card, Field, Skeleton } from "./parts";
import ui from "./owner.module.css";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "not-public"; name: string; status: string }
  | { state: "not-listed"; name: string }
  | { state: "ready"; name: string; url: string };

/**
 * Marketing > Share your shop (requirements #11, #14, #24).
 *
 * The public link comes from the same public directory customers use: the shop appears there only once it
 * is ACTIVE, so a link that is shown is a link that works. Every share target is a normal link or the OS
 * share sheet that the OWNER completes; this page never sends or posts anything itself, and a "copied" or
 * "shared" note only appears when that really happened.
 */
export function ShopSharePanel({ salonId, settingsHref }: { salonId: string; settingsHref: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const own = await apiFetch<RegisterSalonResultDto>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.mine}/${salonId}`);
      if (!isShareable(own.status)) {
        setLoad({ state: "not-public", name: own.name, status: own.status });
        return;
      }
      const results = await apiFetch<PaginatedResult<SalonListItemDto>>(`${DISCOVERY_PATHS.salons}?${new URLSearchParams({ q: own.name, limit: "50" }).toString()}`);
      const listing = findOwnListing(results.items, salonId);
      if (!listing) {
        setLoad({ state: "not-listed", name: own.name });
        return;
      }
      setLoad({ state: "ready", name: own.name, url: `${window.location.origin}${publicShopPath(listing)}` });
      setText((current) => current || defaultInviteText(own.name));
    } catch (err) {
      setLoad({ state: "error", message: err instanceof ApiError ? err.message : "Could not load your shop's public link." });
    }
  }, [salonId]);

  useEffect(() => {
    // Deferred a tick so the effect body never calls setState synchronously (same pattern as the other dashboard pages).
    void Promise.resolve().then(run);
  }, [run]);

  if (load.state === "loading") return <Skeleton height={220} />;
  if (load.state === "error") {
    return (
      <Banner tone="error">
        {load.message} <Btn small onClick={() => void run()}>Try again</Btn>
      </Banner>
    );
  }
  if (load.state === "not-public") {
    return (
      <Banner tone="warn">
        {load.name} is not open to the public yet (status: {load.status.toLowerCase()}), so there is no public page to share. Finish your shop setup and open your shop first.{" "}
        <Link className={ui.cardLink} href={settingsHref}>Shop Settings</Link>
      </Banner>
    );
  }
  if (load.state === "not-listed") {
    return (
      <Banner tone="warn">
        {load.name} is open, but its public page was not found in the directory yet, so a link cannot be checked. Try again in a moment.{" "}
        <Btn small onClick={() => void run()}>Try again</Btn>
      </Banner>
    );
  }

  const { name, url } = load;
  const message = composeMessage(text, url);

  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(done);
    } catch {
      setNotice("Your browser blocked copying. Select the link above and copy it by hand.");
    }
  }

  async function share() {
    const result = await shareOrCopy({ title: `Book at ${name} on FastQue`, text: cleanInviteText(text), url });
    setNotice(
      result === "shared"
        ? "Shared."
        : result === "copied"
          ? "Sharing is not available in this browser, so the message and link were copied instead."
          : result === "cancelled"
            ? null
            : "Sharing is not available in this browser. Use Copy link.",
    );
  }

  function downloadQr() {
    const canvas = qrCanvasRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `fastque-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shop"}-qr.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNotice("QR code downloaded.");
  }

  return (
    <div className={`${ui.grid} ${ui.evenTwo}`}>
      <Card title="Your public shop link" sub="Customers can book or join the Live Queue from this page. It is the same page search engines and the FastQue app show.">
        <Field label="Public link" htmlFor="share-link">
          <input id="share-link" className={ui.input} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <div className={`${ui.rowWrap} ${ui.mt12}`}>
          <Btn variant="primary" onClick={() => void copy(url, "Link copied.")}>Copy link</Btn>
          <BtnLink href={url} target="_blank" rel="noopener noreferrer" icon="arrowUpRight">Open page</BtnLink>
        </div>
        <div className={ui.mt16}>
          <Field label="Message to send with the link" htmlFor="share-message" hint={`${text.length} of ${INVITE_TEXT_MAX} characters. You can edit this freely.`}>
            <textarea id="share-message" className={ui.input} rows={4} maxLength={INVITE_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <p className={ui.cardSub}>What will be sent: <span data-testid="share-preview">{message}</span></p>
        </div>
        <div className={`${ui.rowWrap} ${ui.mt12}`} role="group" aria-label="Share the link">
          <BtnLink href={whatsappShareUrl(text, url)} target="_blank" rel="noopener noreferrer" icon="phone">WhatsApp</BtnLink>
          <BtnLink href={facebookShareUrl(url)} target="_blank" rel="noopener noreferrer" icon="arrowUpRight">Facebook</BtnLink>
          <BtnLink href={emailShareUrl(name, text, url)} icon="arrowUpRight">Email</BtnLink>
          <Btn onClick={() => void share()} icon="arrowUpRight">Share…</Btn>
          <Btn onClick={() => void copy(message, "Message and link copied.")}>Copy message and link</Btn>
        </div>
        <p className={ui.cardSub}>
          These open WhatsApp, Facebook or your email app with the message ready. You choose who gets it and press send yourself; FastQue does not post or send anything for you. For Instagram, use Share… on a phone or paste the copied link into your post or bio.
        </p>
        <div role="status" aria-live="polite" className={ui.mt12}>{notice && <Banner tone="info">{notice}</Banner>}</div>
      </Card>

      <Card title="QR code" sub="Print it at the counter or add it to a poster. Scanning it opens your public page.">
        <div style={{ background: "#fff", padding: 16, borderRadius: 12, width: "fit-content", margin: "0 auto" }}>
          <QRCodeSVG value={url} size={220} level="M" role="img" aria-label={`QR code for ${url}`} />
        </div>
        <div ref={qrCanvasRef} style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
          <QRCodeCanvas value={url} size={1024} level="M" marginSize={4} />
        </div>
        <div className={`${ui.rowWrap} ${ui.mt12}`}>
          <Btn onClick={downloadQr} icon="download">Download QR (PNG)</Btn>
        </div>
      </Card>
    </div>
  );
}
