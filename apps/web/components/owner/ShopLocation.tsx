"use client";

import { useCallback, useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  formatCoordinates,
  formatReviewTime,
  geolocationMessage,
  mapLinkOut,
  parseLocation,
  proposalStatusLabel,
  round6,
  sourceLabel,
  validateCoordinates,
  type CoordinateErrors,
  type LocationView,
  type ProposalSource,
} from "../../lib/location-proposal";
import { Badge, Banner, Btn, BtnLink, Card, Field, Skeleton } from "./parts";
import type { BadgeTone } from "./parts";
import ui from "./owner.module.css";

const STATUS_TONE: Record<string, BadgeTone> = { PENDING: "info", APPROVED: "ok", REJECTED: "bad", SUPERSEDED: "neutral" };

/**
 * Shop location: the owner proposes where the shop is (device location or typed coordinates) and sees what FastQue
 * currently shows. A proposal is private and changes nothing public until a different FastQue reviewer approves it, and
 * this page never says otherwise. There is no map library yet, so the point can be checked through a link to an external
 * map.
 */
export function ShopLocation({ salonId }: { salonId: string }) {
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.location}`;
  const [view, setView] = useState<LocationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [source, setSource] = useState<ProposalSource>("MANUAL");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [errors, setErrors] = useState<CoordinateErrors>({});
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const raw = await apiFetch<unknown>(path);
      const parsed = parseLocation(raw);
      if (!parsed) setLoadError("FastQue sent an answer this page could not read, so your location is not shown.");
      setView(parsed);
    } catch (err) {
      setView(null);
      setLoadError(err instanceof ApiError ? err.message : "Could not load your shop's location.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function useDeviceLocation() {
    setGeoError(null);
    setNotice(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("This browser cannot share a location. Type the coordinates instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatText(String(round6(position.coords.latitude)));
        setLngText(String(round6(position.coords.longitude)));
        setAccuracy(Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null);
        setSource("GPS");
        setErrors({});
        setLocating(false);
      },
      (error) => {
        setGeoError(geolocationMessage(error?.code));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function edited(setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      // Numbers the owner typed or changed are "typed in", even if they started from the device location.
      setSource("MANUAL");
      setAccuracy(null);
      setNotice(null);
    };
  }

  async function submit() {
    setNotice(null);
    setSubmitError(null);
    const { errors: found, value } = validateCoordinates(latText, lngText);
    setErrors(found);
    if (!value) return;
    setSubmitting(true);
    try {
      await apiFetch<unknown>(path, { method: "PATCH", body: JSON.stringify({ latitude: value.latitude, longitude: value.longitude, source }) });
      setNotice("Sent for review. Your public location does not change until FastQue approves it.");
      await load();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not send the proposal. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Skeleton height={200} />;

  const current = view?.current;
  const pending = view?.pending ?? null;
  const preview = validateCoordinates(latText, lngText).value;

  return (
    <div className={ui.mt16}>
      {loadError && <Banner tone="error">{loadError}</Banner>}

      {view && current && (
        <Card title="What customers see now" sub="This is the location FastQue uses for distances and maps on your public page.">
          {current.latitude !== null && current.longitude !== null ? (
            <>
              <p><strong>{formatCoordinates(current.latitude, current.longitude)}</strong>{" "}
                {current.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Not verified yet</Badge>}
              </p>
              {current.verified && current.verifiedAt && <p className={ui.cardSub}>Verified on {formatReviewTime(current.verifiedAt)}.</p>}
              <BtnLink href={mapLinkOut(current.latitude, current.longitude)} target="_blank" rel="noopener noreferrer" icon="arrowUpRight">Check on a map</BtnLink>
            </>
          ) : (
            <p className={ui.cardSub}>No location is set for your shop yet. Without one, customers cannot see how far you are.</p>
          )}
        </Card>
      )}

      {pending && (
        <div className={ui.mt16}>
          <Card title="Your proposal" sub="Only you and FastQue reviewers can see this until it is approved.">
            <p>
              <strong>{formatCoordinates(pending.latitude, pending.longitude)}</strong>{" "}
              <Badge tone={STATUS_TONE[pending.status] ?? "neutral"}>{proposalStatusLabel(pending.status)}</Badge>
            </p>
            <p className={ui.cardSub}>{sourceLabel(pending.source)} · sent {formatReviewTime(pending.submittedAt)}</p>
            {pending.reviewNote && <p className={ui.cardSub}>Reviewer note: {pending.reviewNote}</p>}
            <BtnLink href={mapLinkOut(pending.latitude, pending.longitude)} target="_blank" rel="noopener noreferrer" icon="arrowUpRight">Check on a map</BtnLink>
          </Card>
        </div>
      )}

      <div className={ui.mt16}>
        <Card title="Propose your shop's location" sub="Stand at your shop and use your device location, or type the coordinates. FastQue reviews every proposal before it is shown to customers. Sending a new proposal replaces one that is still waiting.">
          <div className={ui.rowWrap}>
            <Btn variant="primary" icon="arrowUpRight" onClick={useDeviceLocation} disabled={locating || submitting}>{locating ? "Finding your location…" : "Use my device location"}</Btn>
          </div>
          <p className={ui.cardSub}>Your browser will ask permission. The location is used only to fill the boxes below; nothing is sent until you press Send for review.</p>
          {geoError && <Banner tone="warn">{geoError}</Banner>}
          {source === "GPS" && accuracy !== null && (
            <p className={ui.cardSub} role="status">Device location found, accurate to about {accuracy} m. Check the point on a map before you send it.</p>
          )}
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Field label="Latitude" htmlFor="loc-lat" hint={errors.latitude}>
              <input id="loc-lat" className={ui.input} inputMode="decimal" value={latText} onChange={(e) => edited(setLatText)(e.target.value)} aria-invalid={Boolean(errors.latitude)} autoComplete="off" />
            </Field>
            <Field label="Longitude" htmlFor="loc-lng" hint={errors.longitude}>
              <input id="loc-lng" className={ui.input} inputMode="decimal" value={lngText} onChange={(e) => edited(setLngText)(e.target.value)} aria-invalid={Boolean(errors.longitude)} autoComplete="off" />
            </Field>
          </div>
          {preview && (
            <p className={ui.cardSub}>
              <BtnLink small href={mapLinkOut(preview.latitude, preview.longitude)} target="_blank" rel="noopener noreferrer" icon="arrowUpRight">Check this point on a map</BtnLink>
            </p>
          )}
          {submitError && <div className={ui.mt12}><Banner tone="error">{submitError}</Banner></div>}
          <div role="status" aria-live="polite">{notice && <div className={ui.mt12}><Banner tone="ok">{notice}</Banner></div>}</div>
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Btn variant="primary" onClick={() => void submit()} disabled={submitting || locating}>{submitting ? "Sending…" : "Send for review"}</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
