"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { SalonShareLinksDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { shareOrCopy } from "../../lib/booking-actions";
import {
  INVITE_TEXT_MAX,
  classifyShareLinks,
  cleanInviteText,
  composeMessage,
  defaultInviteText,
  emailShareUrl,
  facebookShareUrl,
  whatsappShareUrl,
  type ShareView,
} from "../../lib/shop-share";
import { Banner, Btn, BtnLink, Card, Field, Skeleton } from "./parts";
import ui from "./owner.module.css";

// Scope every result to the requested shop: switching owners/shops must never render an old shop's public link or QR.
type Load =
  | { kind: "loading"; salonId: string }
  | { kind: "error"; salonId: string; message: string }
  | (ShareView & { salonId: string });

/**
 * Marketing > Share your shop (requirements #11, #14, #24).
 *
 * The public link is the server's canonical address for this shop (GET share-links), shown only when the server
 * says the shop is ready. It is never rebuilt from the browser address or found by searching names. Every share target is a normal link or the OS
 * share sheet that the OWNER completes; this page never sends or posts anything itself, and a "copied" or
 * "shared" note only appears when that really happened.
 */
export function ShopSharePanel({ salonId, settingsHref }: { salonId: string; settingsHref: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading", salonId });
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLDivElement>(null);
  const latestRequest = useRef(0);

  const run = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoad({ kind: "loading", salonId });
    setNotice(null);
    try {
      const dto = await apiFetch<SalonShareLinksDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.shareLinks}`);
      const view = classifyShareLinks(dto);
      // An older response must not overwrite another shop's link, QR or retry state.
      if (request !== latestRequest.current) return;
      setLoad({ ...view, salonId });
      if (view.kind === "ready") setText((current) => current || defaultInviteText(view.name));
    } catch (err) {
      if (request !== latestRequest.current) return;
      setLoad({ kind: "error", salonId, message: err instanceof ApiError ? err.message : "Could not load your shop's public link." });
    }
  }, [salonId]);

  useEffect(() => {
    let active = true;
    // Do not carry a previous salon's invitation text/feedback into a new shop.
    // Defer state changes to follow the existing Next/React dashboard effect pattern.
    void Promise.resolve().then(() => {
      if (!active) return;
      setText("");
      setNotice(null);
      void run();
    });
    return () => {
      active = false;
      latestRequest.current += 1;
    };
  }, [run]);

  // Even before the effect cleanup runs, never show a previous shop's public address.
  if (load.salonId !== salonId || load.kind === "loading") return <Skeleton height={220} />;
  if (load.kind === "error") {
    return (
      <Banner tone="error">
        {load.message} <Btn small onClick={() => void run()}>Try again</Btn>
      </Banner>
    );
  }
  if (load.kind === "not-public") {
    return (
      <Banner tone="warn">
        {load.name} is not open to the public yet, so there is no public page to share. Finish your shop setup and open your shop first.{" "}
        <Link className={ui.cardLink} href={settingsHref}>Shop Settings</Link>
      </Banner>
    );
  }
  if (load.kind === "not-configured") {
    return (
      <Banner tone="warn">
        {load.name} is open, but FastQue cannot show its public link right now, so no link or QR code is shown. Try again in a moment.{" "}
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
    // Say what really happened: with no image to save the owner is told so (it used to do nothing), and a browser cannot
    // confirm that a download finished, so only the start of the download is reported.
    const canvas = qrCanvasRef.current?.querySelector("canvas");
    if (!canvas) {
      setNotice("The QR image is not ready yet. Wait a moment and try again, or screenshot the QR code above.");
      return;
    }
    try {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `fastque-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shop"}-qr.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotice("QR code download started. Check your downloads folder.");
    } catch {
      setNotice("Your browser could not save the QR image. Screenshot the QR code above instead.");
    }
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
