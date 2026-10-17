"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { DASHBOARD_PATHS, OWNER_OPS_PATHS } from "@barbercue/shared";
import type {
  BookingAttributionCampaignDto,
  BookingAttributionSummaryDto,
  CreateBookingAttributionCampaignDto,
  PaginatedResult,
  SalonTimezoneResultDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  CAMPAIGN_SOURCES,
  MAX_LABEL_LENGTH,
  buildCampaignUrl,
  canonicalBaseUrl,
  type ShareLinksAnswer,
  STATUS_LABEL,
  campaignStatus,
  formatLastDay,
  formatShopDate,
  sortByBookings,
  sourceLabel,
  summaryQueryString,
  toCreateBody,
  validateCampaignForm,
  type CampaignForm,
  type CampaignFormErrors,
  type CampaignStatus,
} from "../../lib/booking-sources";
import { RANGE_ERROR_TEXT, presetRange, todayInZone, validateRange, type PresetId } from "../../lib/revenue-report";
import { Badge, Banner, Btn, Card, EmptyState, Field, Skeleton } from "./parts";
import type { BadgeTone } from "./parts";
import ui from "./owner.module.css";

const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
];

const STATUS_TONE: Record<CampaignStatus, BadgeTone> = { ACTIVE: "ok", SCHEDULED: "info", ENDED: "neutral", REVOKED: "bad" };
const PAGE_SIZE = 25;
const EMPTY_FORM: CampaignForm = { source: "FACEBOOK", label: "", firstDay: "", lastDay: "" };

/**
 * Booking sources (requirement #3): how many bookings came from the FastQue app, the website, the Live Queue,
 * in-shop appointments and campaign links the owner created. Every figure comes from the server.
 *
 * A campaign code only shows that a booking was made through a link the owner created. It is never described as
 * proof of where the customer really came from.
 */
export function BookingSources({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const attributionBase = `${base}/${OWNER_OPS_PATHS.bookingAttribution}`;
  const [timeZone, setTimeZone] = useState<string | null | undefined>(undefined);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<BookingAttributionSummaryDto | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const summaryRequest = useRef(0);

  const [campaigns, setCampaigns] = useState<BookingAttributionCampaignDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<CampaignFormErrors>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBookingAttributionCampaignDto | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | "no" | null>(null);
  // The shareable link for the campaign just created: the shop's canonical public URL plus its code.
  const [campaignLink, setCampaignLink] = useState<{ phase: "loading" | "ready" | "unavailable"; url: string | null }>({ phase: "loading", url: null });

  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (range: { from: string; to: string }) => {
      const problem = validateRange(range.from, range.to);
      setRangeError(problem ? RANGE_ERROR_TEXT[problem] : null);
      if (problem) return;
      const mine = ++summaryRequest.current;
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const result = await apiFetch<BookingAttributionSummaryDto>(`${attributionBase}/summary?${summaryQueryString(range)}`);
        if (mine !== summaryRequest.current) return;
        setSummary(result);
      } catch (err) {
        if (mine !== summaryRequest.current) return;
        setSummary(null);
        setSummaryError(err instanceof ApiError ? err.message : "Could not load booking sources.");
      } finally {
        if (mine === summaryRequest.current) setSummaryLoading(false);
      }
    },
    [attributionBase],
  );

  const loadCampaigns = useCallback(
    async (cursor: string | null) => {
      if (cursor) setLoadingMore(true);
      else {
        setCampaignsLoading(true);
        setCampaignsError(null);
      }
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) params.set("cursor", cursor);
        const page = await apiFetch<PaginatedResult<BookingAttributionCampaignDto>>(`${attributionBase}/${OWNER_OPS_PATHS.attributionCampaigns}?${params}`);
        setCampaigns((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (err) {
        setCampaignsError(err instanceof ApiError ? err.message : "Could not load your campaign links.");
      } finally {
        setCampaignsLoading(false);
        setLoadingMore(false);
      }
    },
    [attributionBase],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadCampaigns(null);
    });
    apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`)
      .then((result) => {
        if (cancelled) return;
        setTimeZone(result.timezone);
        if (result.timezone) {
          const range = presetRange("last30", todayInZone(result.timezone));
          setFrom(range.from);
          setTo(range.to);
          void loadSummary(range);
        }
      })
      .catch(() => {
        if (!cancelled) setTimeZone(null);
      });
    return () => {
      cancelled = true;
    };
  }, [base, loadCampaigns, loadSummary]);

  if (timeZone === undefined) return <Skeleton height={200} />;
  if (timeZone === null) {
    return (
      <Banner tone="warn">
        Your shop has no timezone yet, so booking dates cannot be computed safely.{" "}
        <Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/settings`}>Set the timezone in Shop Settings</Link>
      </Banner>
    );
  }
  const zone = timeZone;
  const today = todayInZone(zone);

  function choosePreset(id: PresetId) {
    const range = presetRange(id, todayInZone(zone));
    setFrom(range.from);
    setTo(range.to);
    void loadSummary(range);
  }

  async function createCampaign() {
    const errors = validateCampaignForm(form);
    setFormErrors(errors);
    setCreateError(null);
    if (Object.keys(errors).length > 0) return;
    setCreating(true);
    try {
      const result = await apiFetch<CreateBookingAttributionCampaignDto>(`${attributionBase}/${OWNER_OPS_PATHS.attributionCampaigns}`, {
        method: "POST",
        body: JSON.stringify(toCreateBody(form, zone)),
      });
      setCreated(result);
      setCopied(null);
      setForm(EMPTY_FORM);
      setCampaignLink({ phase: "loading", url: null });
      void prepareCampaignLink(result.token);
      await loadCampaigns(null);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create the campaign.");
    } finally {
      setCreating(false);
    }
  }

  async function prepareCampaignLink(token: string) {
    try {
      const answer = await apiFetch<ShareLinksAnswer>(`${base}/share-links`);
      const baseUrl = canonicalBaseUrl(answer);
      const url = baseUrl ? buildCampaignUrl(baseUrl, token) : null;
      setCampaignLink(url ? { phase: "ready", url } : { phase: "unavailable", url: null });
    } catch {
      setCampaignLink({ phase: "unavailable", url: null });
    }
  }

  async function copyText(value: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      setCopied("no");
    }
  }

  async function revoke(campaignId: string) {
    setRevoking(campaignId);
    setRevokeError(null);
    try {
      const updated = await apiFetch<BookingAttributionCampaignDto>(`${attributionBase}/${OWNER_OPS_PATHS.attributionCampaigns}/${campaignId}/revoke`, { method: "POST" });
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setConfirmRevoke(null);
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : "Could not turn the campaign off.");
    } finally {
      setRevoking(null);
    }
  }

  const bySource = summary ? sortByBookings(summary.bySource) : [];
  const byCampaign = summary ? sortByBookings(summary.campaigns) : [];
  const totalBookings = bySource.reduce((sum, row) => sum + row.bookingCount, 0);

  return (
    <div className={ui.mt16}>
      <Card
        title="Where bookings came from"
        sub={`Bookings made in the dates below, by how they reached your shop (${zone}). A campaign link shows that a booking was made through a link you created. It does not prove the customer was on that platform.`}
      >
        <div className={ui.rowWrap}>
          <Field label="From" htmlFor="src-from"><input id="src-from" type="date" className={ui.input} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="src-to"><input id="src-to" type="date" className={ui.input} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
          <Btn variant="primary" onClick={() => void loadSummary({ from, to })} disabled={summaryLoading}>{summaryLoading ? "Loading…" : "Show"}</Btn>
        </div>
        <div className={`${ui.rowWrap} ${ui.mt12}`} role="group" aria-label="Quick ranges">
          {PRESETS.map((p) => (
            <Btn key={p.id} small onClick={() => choosePreset(p.id)} disabled={summaryLoading}>{p.label}</Btn>
          ))}
        </div>
        {rangeError && <div className={ui.mt12}><Banner tone="error">{rangeError}</Banner></div>}
        {summaryError && <div className={ui.mt12}><Banner tone="error">{summaryError}</Banner></div>}
        {summaryLoading && !summary && <div className={ui.mt12}><Skeleton height={120} /></div>}
        {summary && (
          <div aria-busy={summaryLoading} className={ui.mt12}>
            {totalBookings === 0 ? (
              <EmptyState title="No bookings in this range">Try a wider range.</EmptyState>
            ) : (
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <caption className={ui.cardSub}>Bookings by source, {summary.from} to {summary.to}</caption>
                  <thead><tr><th>Source</th><th className={ui.num}>Bookings</th></tr></thead>
                  <tbody>
                    {bySource.map((row) => (
                      <tr key={row.source}><td>{sourceLabel(row.source)}</td><td className={ui.num}>{row.bookingCount}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {byCampaign.length > 0 && (
              <div className={`${ui.tableWrap} ${ui.mt12}`}>
                <table className={ui.table}>
                  <caption className={ui.cardSub}>Bookings by campaign link</caption>
                  <thead><tr><th>Campaign</th><th>Shared on</th><th className={ui.num}>Bookings</th></tr></thead>
                  <tbody>
                    {byCampaign.map((row) => (
                      <tr key={row.campaignId}><td>{row.label}</td><td>{sourceLabel(row.source)}</td><td className={ui.num}>{row.bookingCount}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={ui.cardSub}>Older bookings made before sources were recorded show as “Not recorded”. They are never guessed.</p>
          </div>
        )}
      </Card>

      <div className={ui.mt16}>
        <Card title="Campaign links" sub="Create one code for each place you share your shop (a Facebook post, an Instagram bio, a ChatGPT answer). The code is shown once, so copy it when it appears.">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createCampaign();
            }}
            noValidate
          >
            <div className={ui.rowWrap}>
              <Field label="Shared on" htmlFor="camp-source">
                <select id="camp-source" className={ui.input} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {CAMPAIGN_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Campaign name" htmlFor="camp-label" hint={formErrors.label ?? "For example: Diwali offer post"}>
                <input id="camp-label" className={ui.input} maxLength={MAX_LABEL_LENGTH} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-invalid={Boolean(formErrors.label)} />
              </Field>
              <Field label="First day (optional)" htmlFor="camp-first" hint={formErrors.firstDay}>
                <input id="camp-first" type="date" className={ui.input} value={form.firstDay} onChange={(e) => setForm({ ...form, firstDay: e.target.value })} />
              </Field>
              <Field label="Last day (optional)" htmlFor="camp-last" hint={formErrors.lastDay}>
                <input id="camp-last" type="date" className={ui.input} value={form.lastDay} min={form.firstDay || undefined} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} />
              </Field>
            </div>
            {formErrors.source && <Banner tone="error">{formErrors.source}</Banner>}
            {createError && <div className={ui.mt12}><Banner tone="error">{createError}</Banner></div>}
            <div className={`${ui.rowWrap} ${ui.mt12}`}>
              <Btn type="submit" variant="primary" disabled={creating}>{creating ? "Creating…" : "Create campaign code"}</Btn>
            </div>
          </form>

          {created && (
            <div className={ui.mt16} role="region" aria-label="New campaign link">
              <Banner tone="ok">
                <strong>{created.label}</strong> is ready. The code is shown only once and cannot be recovered. Copy the link now; if you lose it, turn the campaign off and create a new one.
                {campaignLink.phase === "loading" && <p role="status">Preparing your link…</p>}
                {campaignLink.phase === "ready" && campaignLink.url && (
                  <>
                    <div className={ui.mt12}>
                      <Field label="Campaign link" htmlFor="campaign-link">
                        <input id="campaign-link" className={ui.input} readOnly value={campaignLink.url} onFocus={(e) => e.currentTarget.select()} />
                      </Field>
                    </div>
                    <div className={`${ui.rowWrap} ${ui.mt12}`}>
                      <Btn small variant="primary" onClick={() => void copyText(campaignLink.url as string, "link")}>Copy link</Btn>
                    </div>
                    <div style={{ background: "#fff", padding: 12, borderRadius: 12, width: "fit-content", marginTop: 12 }}>
                      <QRCodeSVG value={campaignLink.url} size={160} level="M" role="img" aria-label="QR code for this campaign link" />
                    </div>
                  </>
                )}
                {campaignLink.phase === "unavailable" && (
                  <p role="status">FastQue could not build a link right now because your shop&apos;s public address is not available. You can still copy the code below, but it will not be attached to a link.</p>
                )}
                <div className={ui.mt12}>
                  <span className={ui.cardSub}>Campaign code: </span>
                  <code data-testid="campaign-code">{created.token}</code>
                </div>
                <div className={`${ui.rowWrap} ${ui.mt12}`}>
                  <Btn small onClick={() => void copyText(created.token, "code")}>Copy code</Btn>
                  <Btn small variant="quiet" onClick={() => { setCreated(null); setCopied(null); }}>I have saved it</Btn>
                </div>
                {copied === "link" && <p role="status">Link copied.</p>}
                {copied === "code" && <p role="status">Code copied.</p>}
                {copied === "no" && <p role="status">Could not copy automatically. Select the text and copy it.</p>}
                <p className={ui.cardSub}>Bookings made on the FastQue website from this link are counted for this campaign. Bookings made in the FastQue Android app are not attributed to campaigns yet. This shows that the link was used, not where the customer really came from.</p>
              </Banner>
            </div>
          )}

          {campaignsError && <div className={ui.mt12}><Banner tone="error">{campaignsError}</Banner></div>}
          {revokeError && <div className={ui.mt12}><Banner tone="error">{revokeError}</Banner></div>}
          {campaignsLoading && <div className={ui.mt12}><Skeleton height={100} /></div>}
          {!campaignsLoading && !campaignsError && campaigns.length === 0 && (
            <div className={ui.mt12}><EmptyState title="No campaign links yet">Create your first one above.</EmptyState></div>
          )}
          {campaigns.length > 0 && (
            <div className={`${ui.tableWrap} ${ui.mt12}`}>
              <table className={ui.table}>
                <caption className={ui.cardSub}>Your campaign links</caption>
                <thead><tr><th>Campaign</th><th>Shared on</th><th>Runs</th><th>Status</th><th className={ui.num}>Bookings</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
                <tbody>
                  {campaigns.map((c) => {
                    const status = campaignStatus(c);
                    return (
                      <tr key={c.id}>
                        <td>{c.label}</td>
                        <td>{sourceLabel(c.source)}</td>
                        <td>{formatShopDate(c.startsAt, zone)} to {formatLastDay(c.endsAt, zone)}</td>
                        <td><Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge></td>
                        <td className={ui.num}>{c.bookingCount}</td>
                        <td>
                          {status !== "REVOKED" && (confirmRevoke === c.id ? (
                            <span className={ui.rowWrap}>
                              <Btn small variant="danger" onClick={() => void revoke(c.id)} disabled={revoking === c.id}>{revoking === c.id ? "Turning off…" : "Yes, turn off"}</Btn>
                              <Btn small variant="quiet" onClick={() => setConfirmRevoke(null)} disabled={revoking === c.id}>Keep</Btn>
                            </span>
                          ) : (
                            <Btn small variant="quiet" onClick={() => { setRevokeError(null); setConfirmRevoke(c.id); }} aria-label={`Turn off ${c.label}`}>Turn off</Btn>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {nextCursor && (
                <div className={ui.mt12}><Btn onClick={() => void loadCampaigns(nextCursor)} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</Btn></div>
              )}
              <p className={ui.cardSub}>Turning a campaign off stops new bookings from being linked to it. Past bookings keep their record.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
