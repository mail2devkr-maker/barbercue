"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, OWNER_OPS_PATHS } from "@barbercue/shared";
import type { CreateBookingAttributionCampaignDto, OfferDto, SalonServiceDto, SalonShareLinksDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { shareOrCopy } from "../../../lib/booking-actions";
import { CAMPAIGN_SOURCES, buildCampaignUrl, toCreateBody } from "../../../lib/booking-sources";
import { campaignLabelFor, offerDays, promoState, promoText } from "../../../lib/offer-promo";
import { redemptionText } from "../../../lib/offers";
import { INVITE_TEXT_MAX, classifyShareLinks, cleanInviteText, composeMessage, emailShareUrl, facebookShareUrl, whatsappShareUrl } from "../../../lib/shop-share";
import { Banner, Btn, BtnLink, Card, Field } from "../parts";
import ui from "../owner.module.css";

type Shop = { phase: "loading" } | { phase: "error"; message: string } | { phase: "closed"; message: string } | { phase: "ready"; name: string; url: string };
type Tracking = { phase: "idle" } | { phase: "creating" } | { phase: "error"; message: string } | { phase: "ready"; url: string };

/**
 * "Prepare a post" for one offer (owner issue #17). It writes the post text from the offer, gives the shop's public link (optionally a
 * tracking link so the Booking sources page can count bookings from that post) and hands the owner the usual share routes. FastQue
 * posts NOTHING anywhere: the owner reviews and publishes. The only numbers shown are ones FastQue really has (how many bookings used
 * the offer); there are no reach, like or click figures because FastQue cannot see them.
 */
export function OfferPromoPanel({ salonId, offer, services, timeZone }: { salonId: string; offer: OfferDto; services: SalonServiceDto[]; timeZone: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const state = promoState(offer, timeZone);
  const [shop, setShop] = useState<Shop>({ phase: "loading" });
  const [text, setText] = useState("");
  const [source, setSource] = useState<string>("FACEBOOK");
  const [tracking, setTracking] = useState<Tracking>({ phase: "idle" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!state.ok) return;
    void Promise.resolve().then(async () => {
      try {
        const dto = await apiFetch<SalonShareLinksDto>(`${base}/${DASHBOARD_PATHS.shareLinks}`);
        if (!active) return;
        const view = classifyShareLinks(dto);
        if (view.kind === "ready") {
          const names = offer.serviceIds.map((id) => services.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));
          setShop({ phase: "ready", name: view.name, url: view.url });
          setText(promoText(offer, view.name, names.length === offer.serviceIds.length ? names : null, timeZone));
        } else {
          setShop({ phase: "closed", message: view.kind === "not-public" ? "Your shop is not open to the public yet, so there is no page to point a post at." : "FastQue has no trusted public address for your shop yet, so no link can be made." });
        }
      } catch (err) {
        if (active) setShop({ phase: "error", message: err instanceof ApiError ? err.message : "Could not load your shop's public link." });
      }
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the post is prepared once per opening; later edits are the owner's
  }, [base, offer.id]);

  if (!state.ok) {
    return (
      <div className={ui.mt12}>
        <Banner tone="info">{state.reason}</Banner>
      </div>
    );
  }
  if (shop.phase === "loading") return <p className={ui.hint} role="status">Preparing your post…</p>;
  if (shop.phase === "error" || shop.phase === "closed") return <div className={ui.mt12}><Banner tone="error">{shop.message}</Banner></div>;

  const link = tracking.phase === "ready" ? tracking.url : shop.url;
  const message = composeMessage(text, link);

  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(done);
    } catch {
      setNotice("Your browser blocked copying. Select the text and copy it by hand.");
    }
  }

  async function share() {
    const result = await shareOrCopy({ title: offer.title, text: cleanInviteText(text), url: link });
    setNotice(
      result === "shared" ? "Shared." : result === "copied" ? "Sharing is not available in this browser, so the post and link were copied instead." : result === "cancelled" ? null : "Sharing is not available in this browser. Use Copy post.",
    );
  }

  async function makeTrackingLink() {
    if (shop.phase !== "ready") return;
    setTracking({ phase: "creating" });
    setNotice(null);
    try {
      const { firstDay, lastDay } = offerDays(offer, timeZone);
      const body = toCreateBody({ source, label: campaignLabelFor(offer), firstDay, lastDay }, timeZone);
      const created = await apiFetch<CreateBookingAttributionCampaignDto>(`${base}/${OWNER_OPS_PATHS.bookingAttribution}/${OWNER_OPS_PATHS.attributionCampaigns}`, { method: "POST", body: JSON.stringify(body) });
      const url = buildCampaignUrl(shop.url, created.token);
      setTracking(url ? { phase: "ready", url } : { phase: "error", message: "The tracking link could not be built. The plain shop link is still available." });
    } catch (err) {
      setTracking({ phase: "error", message: err instanceof ApiError ? err.message : "Could not create the tracking link. The plain shop link is still available." });
    }
  }

  return (
    <div className={ui.mt12}>
      <Card title="Prepare a post for this offer" sub="FastQue writes the text and gives you the link. You review it and publish it yourself. FastQue posts nothing on Facebook, Instagram or anywhere else.">
        <Field label="Post text" htmlFor={`promo-text-${offer.id}`} hint={`${text.length} of ${INVITE_TEXT_MAX} characters. Edit it freely; it is built only from this offer's details.`}>
          <textarea id={`promo-text-${offer.id}`} className={ui.input} rows={6} value={text} maxLength={INVITE_TEXT_MAX} onChange={(e) => { setText(e.target.value); setNotice(null); }} />
        </Field>

        <Field label="Link in the post" htmlFor={`promo-link-${offer.id}`} hint={tracking.phase === "ready" ? "Tracking link: bookings made through it are counted under this offer's campaign." : "Your shop's public page. Make a tracking link below to count bookings from this post."}>
          <input id={`promo-link-${offer.id}`} className={ui.input} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </Field>

        <div className={ui.rowWrap}>
          <Field label="Where will you post it?" htmlFor={`promo-source-${offer.id}`}>
            <select id={`promo-source-${offer.id}`} className={ui.input} value={source} onChange={(e) => { setSource(e.target.value); setTracking({ phase: "idle" }); }}>
              {CAMPAIGN_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Btn onClick={() => void makeTrackingLink()} disabled={tracking.phase === "creating" || tracking.phase === "ready"}>
            {tracking.phase === "creating" ? "Making link…" : tracking.phase === "ready" ? "Tracking link ready" : "Make a tracking link"}
          </Btn>
        </div>
        {tracking.phase === "error" && <Banner tone="error">{tracking.message}</Banner>}

        <div className={`${ui.rowWrap} ${ui.mt12}`}>
          <Btn variant="primary" onClick={() => void copy(message, "Post and link copied.")}>Copy post</Btn>
          <Btn onClick={() => void share()}>Share…</Btn>
          <BtnLink href={whatsappShareUrl(text, link)} target="_blank" rel="noopener noreferrer">WhatsApp</BtnLink>
          <BtnLink href={facebookShareUrl(link)} target="_blank" rel="noopener noreferrer">Facebook</BtnLink>
          <BtnLink href={emailShareUrl(shop.name, text, link)}>Email</BtnLink>
        </div>
        <p className={ui.hint}>Instagram has no sharing page for the web. Copy the post, open Instagram on your phone and paste it into your post or story caption.</p>
        {notice && <p role="status" className={ui.hint}>{notice}</p>}

        <p className={ui.hint}>
          What FastQue can tell you: {redemptionText(offer)}.{" "}
          <Link href={`/dashboard/salons/${salonId}/booking-sources`}>See bookings from your campaigns</Link>. FastQue cannot see likes, reach or clicks on Facebook or Instagram, so none are shown.
        </p>
      </Card>
    </div>
  );
}
