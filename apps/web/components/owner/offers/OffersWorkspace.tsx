"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OfferDto, OfferPreviewDto, OfferRedemptionStatsDto, SalonServiceDto, SalonTimezoneResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { isUsable, unavailableMessage } from "../../../lib/capabilities";
import { newIdempotencyKey } from "../../../lib/idempotency";
import { useCapabilities } from "../../../lib/use-capabilities";
import { useCursorList } from "../../../lib/use-cursor-list";
import {
  AUDIENCE_OPTIONS,
  EMPTY_OFFER_FORM,
  KIND_OPTIONS,
  MAX_OFFER_SERVICES,
  STATUS_OPTIONS,
  audienceText,
  buildOfferBody,
  buildOfferPatch,
  canEdit,
  canPause,
  canPublish,
  discountText,
  formFromOffer,
  kindLabel,
  offerErrorText,
  previewErrorText,
  previewMoney,
  redemptionText,
  servicesText,
  statusLabel,
  statusTone,
  validityText,
  type OfferErrors,
  type OfferForm,
} from "../../../lib/offers";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, Skeleton } from "../parts";
import ui from "../owner.module.css";

const MISMATCH = ["INVALID_FILTER", "CURSOR_FILTER_MISMATCH"] as const;
const LIST_OPTIONS = { mismatchCodes: MISMATCH, errorText: offerErrorText };

type Editing = { offer: OfferDto | null };
type Confirm = { action: "publish" | "pause"; offer: OfferDto };

/**
 * Owner Offers, Promotions and Daily Deals. Shown only when the server reports the `offers` capability as usable. An offer is a
 * price rule: publishing makes it visible to customers who qualify and lets them use it when booking online; nothing here
 * collects money, sends a message or counts as a payment. The server decides eligibility again at booking time.
 */
export function OffersWorkspace({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const capabilities = useCapabilities(salonId);
  const usable = isUsable(capabilities.features, "offers");

  const [timeZone, setTimeZone] = useState<string | null | undefined>(undefined);
  const [services, setServices] = useState<SalonServiceDto[]>([]);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<{ offerId: string; stats: OfferRedemptionStatsDto | null; error: string | null } | null>(null);
  const [previewFor, setPreviewFor] = useState<{ offerId: string; preview: OfferPreviewDto | null; error: string | null; note?: string } | null>(null);
  const keys = useRef(new Map<string, string>());

  const list = useCursorList<OfferDto>(`${base}/offers`, { kind, status }, usable, LIST_OPTIONS);

  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const [tz, svc] = await Promise.all([
          apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`),
          apiFetch<SalonServiceDto[]>(`${base}/${DASHBOARD_PATHS.services}`),
        ]);
        if (cancelled) return;
        setTimeZone(tz.timezone ?? null);
        setServices(Array.isArray(svc) ? svc.filter((s) => s.isActive !== false) : []);
      } catch {
        if (!cancelled) setTimeZone(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [usable, base]);

  /** One Idempotency-Key per distinct action, kept until it succeeds, so a retry after a lost answer is the same request. */
  const keyFor = useCallback((signature: string): string => {
    const existing = keys.current.get(signature);
    if (existing) return existing;
    const fresh = newIdempotencyKey();
    keys.current.set(signature, fresh);
    return fresh;
  }, []);

  if (capabilities.phase === "loading") return <Skeleton height={160} />;
  if (!usable) {
    return (
      <EmptyState title="Offers are not available yet">
        {unavailableMessage(capabilities.phase === "ready" ? capabilities.features : null, "offers")} Nothing about your shop is affected.
      </EmptyState>
    );
  }

  async function run(signature: string, request: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await request();
      keys.current.delete(signature);
      setNotice(done);
      setConfirm(null);
      setEditing(null);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? offerErrorText(err.code, err.message) : "That did not go through. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  function confirmAction() {
    if (!confirm) return;
    const { action, offer } = confirm;
    const signature = `${action}:${offer.id}`;
    const words = action === "publish" ? `“${offer.title}” is now active.` : `“${offer.title}” is paused.`;
    void run(
      signature,
      () => apiFetch<OfferDto>(`${base}/offers/${offer.id}/${action}`, { method: "POST", headers: { "Idempotency-Key": keyFor(signature) } }),
      words,
    );
  }

  async function showStats(offer: OfferDto) {
    setStatsFor({ offerId: offer.id, stats: null, error: null });
    try {
      const stats = await apiFetch<OfferRedemptionStatsDto>(`${base}/offers/${offer.id}/stats`);
      setStatsFor({ offerId: offer.id, stats, error: null });
    } catch (err) {
      setStatsFor({ offerId: offer.id, stats: null, error: err instanceof ApiError ? offerErrorText(err.code, err.message) : "Could not load the numbers." });
    }
  }

  async function showPreview(offer: OfferDto) {
    // A saved offer is checked against named services (the server needs at least one and at most 100); "all services" uses the active ones.
    const ids = offer.serviceIds.length > 0 ? offer.serviceIds : services.slice(0, MAX_OFFER_SERVICES).map((s) => s.id);
    const note = offer.serviceIds.length === 0 && services.length > MAX_OFFER_SERVICES ? `This check covers the first ${MAX_OFFER_SERVICES} of your ${services.length} active services.` : undefined;
    if (ids.length === 0) {
      setPreviewFor({ offerId: offer.id, preview: null, error: "Add an active service before previewing prices." });
      return;
    }
    setPreviewFor({ offerId: offer.id, preview: null, error: null, note });
    try {
      const preview = await apiFetch<OfferPreviewDto>(`${base}/offers/${offer.id}/preview`, { method: "POST", body: JSON.stringify({ serviceIds: ids }) });
      setPreviewFor({ offerId: offer.id, preview, error: null, note });
    } catch (err) {
      setPreviewFor({ offerId: offer.id, preview: null, error: err instanceof ApiError ? previewErrorText(err.code, err.message) : "Could not preview the prices.", note });
    }
  }

  const filtering = kind !== "" || status !== "";

  return (
    <div className={ui.mt16}>
      <Banner tone="info">
        Customers see an offer only while it is Active and inside its dates. An offer changes the price shown when someone books online; it
        does not take any payment and FastQue does not message anyone about it.
      </Banner>

      {timeZone === null && (
        <div className={ui.mt12}>
          <Banner tone="warn">
            Your shop has no timezone yet, so offer dates cannot be set safely.{" "}
            <Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/settings`}>Set the timezone in Shop Settings</Link>
          </Banner>
        </div>
      )}

      {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
      <div role="status" aria-live="polite">{notice && <div className={ui.mt12}><Banner tone="ok">{notice}</Banner></div>}</div>

      {editing && timeZone && (
        <OfferEditor
          key={editing.offer?.id ?? "new"}
          offer={editing.offer}
          services={services}
          timeZone={timeZone}
          base={base}
          busy={busy}
          keyFor={keyFor}
          onCancel={() => setEditing(null)}
          onSave={(signature, request, done) => void run(signature, request, done)}
        />
      )}

      <div className={ui.mt16}>
        <Card
          title="Your offers"
          sub="Offers, promotions and daily deals for online bookings."
          action={timeZone ? <Btn variant="primary" onClick={() => { setNotice(null); setEditing({ offer: null }); }} disabled={Boolean(editing)}>Create an offer</Btn> : undefined}
        >
          <div className={ui.rowWrap} role="search" aria-label="Filter offers">
            <Field label="Type" htmlFor="offer-kind">
              <select id="offer-kind" className={ui.input} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All types</option>
                {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Status" htmlFor="offer-status">
              <select id="offer-status" className={ui.input} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
          </div>

          <div className={ui.mt12}>
            {list.loading ? (
              <Skeleton height={120} />
            ) : list.items.length === 0 && !list.error ? (
              <EmptyState title={filtering ? "No offer matches these filters" : "You have no offers yet"}>
                {filtering ? "Clear a filter to see more." : "Create your first offer, then publish it when you are ready."}
              </EmptyState>
            ) : (
              <ul className={ui.list} aria-label="Offers">
                {list.items.map((offer) => (
                  <li key={offer.id} className={ui.listRow} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                    <div className={ui.rowWrap}>
                      <strong>{offer.title}</strong>
                      <Badge tone="brand">{kindLabel(offer.kind)}</Badge>
                      <Badge tone={statusTone(offer.status)}>{statusLabel(offer.status)}</Badge>
                      <span>{discountText(offer)}</span>
                    </div>
                    <div className={ui.hint}>
                      {timeZone ? validityText(offer, timeZone) : `${offer.validFrom} to ${offer.validTo}`} · {audienceText(offer)} · {servicesText(offer)} · {redemptionText(offer)}
                    </div>
                    <div className={ui.rowWrap}>
                      {canEdit(offer.status) && timeZone && <Btn small onClick={() => { setNotice(null); setEditing({ offer }); }} disabled={Boolean(editing)}>Edit</Btn>}
                      {offer.status === "ACTIVE" && <span className={ui.hint}>Pause it to change it.</span>}
                      {canPublish(offer.status) && <Btn small variant="primary" onClick={() => setConfirm({ action: "publish", offer })} disabled={busy}>Publish</Btn>}
                      {canPause(offer.status) && <Btn small onClick={() => setConfirm({ action: "pause", offer })} disabled={busy}>Pause</Btn>}
                      <Btn small variant="quiet" onClick={() => void showPreview(offer)}>Preview prices</Btn>
                      <Btn small variant="quiet" onClick={() => void showStats(offer)}>See numbers</Btn>
                    </div>
                    {previewFor?.offerId === offer.id && <PreviewPanel state={previewFor} />}
                    {statsFor?.offerId === offer.id && <StatsPanel state={statsFor} />}
                  </li>
                ))}
              </ul>
            )}
            {list.error && <div className={ui.mt12}><Banner tone="error">{list.error} <Btn small onClick={list.reload}>Try again</Btn></Banner></div>}
            {list.notice && <div className={ui.mt12} role="status"><Banner tone="info">{list.notice}</Banner></div>}
            {list.hasMore && (
              <div className={ui.mt12}>
                <Btn onClick={list.loadMore} disabled={list.loadingMore}>{list.loadingMore ? "Loading…" : "Load more"}</Btn>
              </div>
            )}
          </div>
        </Card>
      </div>

      {confirm && (
        <Dialog title={confirm.action === "publish" ? "Publish this offer?" : "Pause this offer?"} onClose={() => (busy ? undefined : setConfirm(null))}>
          <p>
            {confirm.action === "publish"
              ? `“${confirm.offer.title}” becomes visible to customers who qualify, and they can use it when booking online during its dates. It takes no payment and sends no message.`
              : `Nobody can use “${confirm.offer.title}” until you publish it again. Bookings that already used it keep their price.`}
          </p>
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Btn variant="primary" onClick={confirmAction} disabled={busy}>{busy ? "Working…" : confirm.action === "publish" ? "Publish" : "Pause"}</Btn>
            <Btn variant="quiet" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Btn>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PreviewPanel({ state }: { state: { preview: OfferPreviewDto | null; error: string | null; note?: string } }) {
  if (state.error) return <Banner tone="error">{state.error}</Banner>;
  if (!state.preview) return <Skeleton height={60} />;
  return (
    <>
      {state.note && <div className={ui.hint}>{state.note}</div>}
      <PreviewTable preview={state.preview} />
    </>
  );
}

function PreviewTable({ preview }: { preview: OfferPreviewDto }) {
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <caption className={ui.cardSub}>Price check (arithmetic only; the server decides who is eligible when they book)</caption>
        <thead><tr><th>Service</th><th className={ui.num}>Price</th><th className={ui.num}>Discount</th><th className={ui.num}>Customer pays</th></tr></thead>
        <tbody>
          {preview.lines.map((l) => (
            <tr key={l.serviceId}>
              <td>{l.serviceName}</td>
              <td className={ui.num}>{previewMoney(l.basePrice, l.currency)}</td>
              <td className={ui.num}>{previewMoney(l.discount, l.currency)}</td>
              <td className={ui.num}>{previewMoney(l.finalPrice, l.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>If one of each is booked</th>
            <td className={ui.num}>{previewMoney(preview.subtotal, preview.currency)}</td>
            <td className={ui.num}>{previewMoney(preview.discount, preview.currency)}</td>
            <td className={ui.num}>{previewMoney(preview.finalTotal, preview.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function StatsPanel({ state }: { state: { stats: OfferRedemptionStatsDto | null; error: string | null } }) {
  if (state.error) return <Banner tone="error">{state.error}</Banner>;
  if (!state.stats) return <Skeleton height={40} />;
  const s = state.stats;
  return (
    <div className={ui.hint} role="status">
      {s.redemptionCount} booking{s.redemptionCount === 1 ? "" : "s"} used this offer, by {s.uniqueCustomers} different customer{s.uniqueCustomers === 1 ? "" : "s"}.{" "}
      {s.completedBookings} completed, {s.cancelledBookings} cancelled. Discount given in those bookings: {previewMoney(s.recordedDiscount, s.currency)}, as the price at the time of booking (not a payment or a refund). A cancelled booking does not give its use back.
    </div>
  );
}

function OfferEditor({
  offer,
  services,
  timeZone,
  base,
  busy,
  keyFor,
  onCancel,
  onSave,
}: {
  offer: OfferDto | null;
  services: SalonServiceDto[];
  timeZone: string;
  base: string;
  busy: boolean;
  keyFor: (signature: string) => string;
  onCancel: () => void;
  onSave: (signature: string, request: () => Promise<unknown>, done: string) => void;
}) {
  const [form, setForm] = useState<OfferForm>(() => (offer ? formFromOffer(offer, timeZone) : EMPTY_OFFER_FORM));
  const [errors, setErrors] = useState<OfferErrors>({});
  const [check, setCheck] = useState<{ preview: OfferPreviewDto | null; error: string | null } | null>(null);
  const set = (patch: Partial<OfferForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setCheck(null);
  };

  function save() {
    if (offer) {
      const { body, errors: found } = buildOfferPatch(offer, form, timeZone);
      setErrors(found);
      if (Object.keys(found).length > 0) return;
      if (!body) {
        onCancel();
        return;
      }
      const signature = `patch:${offer.id}:${JSON.stringify(body)}`;
      onSave(signature, () => apiFetch<OfferDto>(`${base}/offers/${offer.id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Idempotency-Key": keyFor(signature) } }), `“${form.title.trim()}” saved. Publish it when you are ready.`);
      return;
    }
    const { body, errors: found } = buildOfferBody(form, timeZone);
    setErrors(found);
    if (!body) return;
    const signature = `create:${JSON.stringify(body)}`;
    onSave(signature, () => apiFetch<OfferDto>(`${base}/offers`, { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": keyFor(signature) } }), `“${body.title}” saved as a draft. Customers cannot see it until you publish it.`);
  }

  async function checkPrices() {
    const { body, errors: found } = buildOfferBody(form, timeZone);
    setErrors(found);
    if (!body) return;
    // An empty service list is the server's own "every active service" (bounded to 100); it is sent as it is, never filled in here.
    setCheck({ preview: null, error: null });
    try {
      const preview = await apiFetch<OfferPreviewDto>(`${base}/offers/preview`, { method: "POST", body: JSON.stringify(body) });
      setCheck({ preview, error: null });
    } catch (err) {
      setCheck({ preview: null, error: err instanceof ApiError ? previewErrorText(err.code, err.message) : "Could not check the prices." });
    }
  }

  const toggleService = (id: string) => set({ serviceIds: form.serviceIds.includes(id) ? form.serviceIds.filter((x) => x !== id) : [...form.serviceIds, id] });

  return (
    <div className={ui.mt16}>
      <Card title={offer ? "Edit offer" : "Create an offer"} sub={`Dates and times are in your shop's timezone (${timeZone}).`}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          <div className={ui.rowWrap}>
            <Field label="Type" htmlFor="offer-form-kind" hint={KIND_OPTIONS.find((k) => k.value === form.kind)?.help}>
              <select id="offer-form-kind" className={ui.input} value={form.kind} onChange={(e) => set({ kind: e.target.value as OfferForm["kind"] })}>
                {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Name" htmlFor="offer-title" hint={errors.title}>
              <input id="offer-title" className={ui.input} maxLength={120} value={form.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={Boolean(errors.title)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Description (optional)" htmlFor="offer-description" hint={errors.description}>
            <textarea id="offer-description" className={ui.input} rows={2} maxLength={500} value={form.description} onChange={(e) => set({ description: e.target.value })} aria-invalid={Boolean(errors.description)} />
          </Field>
          <div className={ui.rowWrap}>
            <Field label="Discount" htmlFor="offer-discount-type">
              <select id="offer-discount-type" className={ui.input} value={form.discountType} onChange={(e) => set({ discountType: e.target.value as OfferForm["discountType"] })}>
                <option value="PERCENT">Percentage off</option>
                <option value="FLAT">Fixed amount off</option>
              </select>
            </Field>
            <Field label={form.discountType === "PERCENT" ? "Percent (1 to 100)" : "Amount off"} htmlFor="offer-discount-value" hint={errors.discountValue}>
              <input id="offer-discount-value" className={ui.input} inputMode="decimal" value={form.discountValue} onChange={(e) => set({ discountValue: e.target.value })} aria-invalid={Boolean(errors.discountValue)} autoComplete="off" />
            </Field>
          </div>
          <div className={ui.rowWrap}>
            <Field label="Who can use it" htmlFor="offer-audience" hint={AUDIENCE_OPTIONS.find((a) => a.value === form.audience)?.help}>
              <select id="offer-audience" className={ui.input} value={form.audience} onChange={(e) => set({ audience: e.target.value as OfferForm["audience"] })}>
                {AUDIENCE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>
            {form.audience === "INACTIVE" && (
              <Field label="Days since last visit" htmlFor="offer-inactive-days" hint={errors.inactiveDays}>
                <input id="offer-inactive-days" className={ui.input} inputMode="numeric" value={form.inactiveDays} onChange={(e) => set({ inactiveDays: e.target.value })} aria-invalid={Boolean(errors.inactiveDays)} autoComplete="off" />
              </Field>
            )}
          </div>
          <div className={ui.rowWrap}>
            <Field label="Starts" htmlFor="offer-valid-from" hint={errors.validFrom}>
              <input id="offer-valid-from" type="datetime-local" className={ui.input} value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} aria-invalid={Boolean(errors.validFrom)} />
            </Field>
            <Field label="Ends" htmlFor="offer-valid-to" hint={errors.validTo}>
              <input id="offer-valid-to" type="datetime-local" className={ui.input} value={form.validTo} onChange={(e) => set({ validTo: e.target.value })} aria-invalid={Boolean(errors.validTo)} />
            </Field>
          </div>
          <div className={ui.rowWrap}>
            <Field label="Total uses allowed (optional)" htmlFor="offer-max" hint={errors.maxRedemptions ?? "Leave empty for no limit. A cancelled booking does not give its use back."}>
              <input id="offer-max" className={ui.input} inputMode="numeric" value={form.maxRedemptions} onChange={(e) => set({ maxRedemptions: e.target.value })} aria-invalid={Boolean(errors.maxRedemptions)} autoComplete="off" />
            </Field>
            <Field label="Uses per customer" htmlFor="offer-per-customer" hint={errors.perCustomerLimit}>
              <input id="offer-per-customer" className={ui.input} inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => set({ perCustomerLimit: e.target.value })} aria-invalid={Boolean(errors.perCustomerLimit)} autoComplete="off" />
            </Field>
          </div>

          <fieldset className={ui.mt12} style={{ border: 0, padding: 0 }}>
            <legend className={ui.label}>Services</legend>
            <div className={ui.hint}>
              {form.serviceIds.length === 0 ? "All your active services are included. Tick services to limit the offer to them." : `${form.serviceIds.length} selected.`}
            </div>
            {errors.serviceIds && <div className={ui.hint} role="alert">{errors.serviceIds}</div>}
            {services.length === 0 ? (
              <div className={ui.hint}>You have no active services yet.</div>
            ) : (
              <div className={ui.rowWrap} style={{ marginTop: 8 }}>
                {services.map((s) => (
                  <label key={s.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={form.serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {check && (
            <div className={ui.mt12}>
              {check.error ? <Banner tone="error">{check.error}</Banner> : check.preview ? <PreviewTable preview={check.preview} /> : <Skeleton height={60} />}
            </div>
          )}

          <div className={`${ui.rowWrap} ${ui.mt16}`}>
            <Btn type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : offer ? "Save changes" : "Save as draft"}</Btn>
            <Btn onClick={() => void checkPrices()} disabled={busy}>Check prices</Btn>
            <Btn variant="quiet" onClick={onCancel} disabled={busy}>Cancel</Btn>
          </div>
        </form>
      </Card>
    </div>
  );
}
