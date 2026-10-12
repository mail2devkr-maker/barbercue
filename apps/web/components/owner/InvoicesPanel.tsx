"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DASHBOARD_PATHS, billingProfileSchema, recordInvoicePaymentSchema, voidInvoiceSchema } from "@barbercue/shared";
import type {
  BillingProfileDto,
  InvoiceDetailDto,
  InvoiceListDto,
  InvoicePaymentMethod,
  InvoicePaymentStatus,
  InvoiceSummaryDto,
  OwnerRevenueDto,
} from "@barbercue/shared";
import { apiFetch, apiFetchBlob, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { formatMoney, formatShopDate, formatShopTime, triggerBlobDownload } from "./format";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, PageHead, Skeleton, Tabs, type BadgeTone } from "./parts";
import ui from "./owner.module.css";

const STATUS_BADGE: Record<InvoicePaymentStatus, { text: string; tone: BadgeTone }> = {
  UNPAID: { text: "Unpaid", tone: "warn" },
  PARTIALLY_PAID: { text: "Partly paid", tone: "info" },
  PAID: { text: "Paid", tone: "ok" },
  REFUNDED: { text: "Refunded", tone: "neutral" },
  VOID: { text: "Void", tone: "bad" },
};
const METHOD_LABEL: Record<InvoicePaymentMethod, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other" };

type Tab = "invoices" | "billing";

export function InvoicesPanel({ salonId }: { salonId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "billing" ? "billing" : "invoices";
  const openId = params.get("open");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <>
      <PageHead
        eyebrow="Business"
        title="Billing & invoices"
        sub="Invoices are created from completed services at their real prices. “Paid” always means a payment your shop recorded here — nothing is assumed from a QR code or a completed service."
        actions={
          <Tabs
            label="Billing sections"
            value={tab}
            onChange={(t) => setParam("tab", t === "billing" ? "billing" : null)}
            tabs={[
              { id: "invoices", label: "Invoices" },
              { id: "billing", label: "Billing profile" },
            ]}
          />
        }
      />
      {tab === "billing" ? <BillingProfile salonId={salonId} /> : <InvoiceList salonId={salonId} openId={openId} onOpen={(id) => setParam("open", id)} />}
    </>
  );
}

function InvoiceList({ salonId, openId, onOpen }: { salonId: string; openId: string | null; onOpen: (id: string | null) => void }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [filter, setFilter] = useState<InvoicePaymentStatus | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<InvoiceSummaryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<OwnerRevenueDto | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (cursor?: string) => {
      const search = new URLSearchParams({ payment: filter, ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}) });
      return apiFetch<InvoiceListDto>(`${base}/invoices?${search.toString()}`)
        .then((page) => {
          setItems((cur) => (cursor && cur ? [...cur, ...page.items] : page.items));
          setNext(page.nextCursor);
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load invoices."));
    },
    [base, filter, query],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state while the new filter is fetched
    setItems(null);
    void load();
  }, [load]);
  useEffect(() => {
    apiFetch<OwnerRevenueDto>(`${base}/revenue`).then(setRevenue).catch(() => {});
  }, [base]);
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <>
      {revenue && (
        <div className={`${ui.statGrid} ${ui.mt12}`} style={{ marginBottom: 16 }}>
          <div className={ui.stat}>
            <div className={ui.statLabel}>Awaiting payment</div>
            <div className={ui.statValue}>{revenue.unpaidInvoiceCount}</div>
            <div className={ui.cardSub}>{formatMoney(revenue.unpaidInvoiceTotal, revenue.currency)} still due</div>
          </div>
          <div className={ui.stat}>
            <div className={ui.statLabel}>Recorded today</div>
            <div className={ui.statValue}>{formatMoney(revenue.today.current, revenue.currency)}</div>
          </div>
          <div className={ui.stat}>
            <div className={ui.statLabel}>Recorded this month</div>
            <div className={ui.statValue}>{formatMoney(revenue.thisMonth.current, revenue.currency)}</div>
          </div>
        </div>
      )}
      <Card>
        <div className={ui.rowWrap} style={{ marginBottom: 12 }}>
          <div style={{ flex: "1 1 220px" }}>
            <label className={ui.srOnly} htmlFor="inv-search">
              Search invoices
            </label>
            <input id="inv-search" className={ui.input} placeholder="Search by invoice number or customer…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className={ui.srOnly} htmlFor="inv-filter">
              Payment status
            </label>
            <select id="inv-filter" className={ui.select} value={filter} onChange={(e) => setFilter(e.target.value as InvoicePaymentStatus | "ALL")}>
              <option value="ALL">All invoices</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partly paid</option>
              <option value="PAID">Paid</option>
              <option value="REFUNDED">Refunded</option>
              <option value="VOID">Void</option>
            </select>
          </div>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        {items === null && !error && <Skeleton height={120} />}
        {items && items.length === 0 && (
          <EmptyState title="No invoices yet">
            Open a completed booking or a completed Live Queue visit and choose “Create invoice”. Set up your business details under the Billing profile tab first.
          </EmptyState>
        )}
        {items && items.length > 0 && (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>For</th>
                  <th className={ui.num}>Total</th>
                  <th className={ui.num}>Balance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => {
                  const badge = STATUS_BADGE[inv.paymentStatus];
                  return (
                    <tr key={inv.id}>
                      <td>
                        <strong>{inv.number}</strong>
                      </td>
                      <td>{formatShopDate(inv.issuedAt, null, true)}</td>
                      <td>{inv.customerName ?? <span className={ui.mutedCell}>Customer</span>}</td>
                      <td>{inv.sourceType === "BOOKING" ? "Booking" : "Live Queue visit"}</td>
                      <td className={ui.num}>{formatMoney(inv.total, inv.currency)}</td>
                      <td className={ui.num}>{formatMoney(inv.balanceDue, inv.currency)}</td>
                      <td>
                        <Badge tone={badge.tone}>{badge.text}</Badge>
                      </td>
                      <td>
                        <Btn small onClick={() => onOpen(inv.id)} aria-label={`Open invoice ${inv.number}`}>
                          Open
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {next && (
          <div className={ui.mt12}>
            <Btn
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void load(next).finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Btn>
          </div>
        )}
      </Card>
      {openId && <InvoiceDrawer salonId={salonId} invoiceId={openId} onClose={() => onOpen(null)} onChanged={() => void load()} />}
    </>
  );
}

function InvoiceDrawer({ salonId, invoiceId, onClose, onChanged }: { salonId: string; invoiceId: string; onClose: () => void; onChanged: () => void }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/invoices/${invoiceId}`;
  const [inv, setInv] = useState<InvoiceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"payment" | "refund" | "void" | null>(null);

  const reload = useCallback(() => {
    apiFetch<InvoiceDetailDto>(base)
      .then((d) => {
        setInv(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this invoice."));
  }, [base]);
  useEffect(reload, [reload]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await apiFetchBlob(`${base}/pdf`);
      triggerBlobDownload(blob, filename ?? `${inv?.number ?? "invoice"}.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the PDF.");
    } finally {
      setBusy(false);
    }
  }

  const money = (n: number) => formatMoney(n, inv?.currency ?? "INR");
  return (
    <Dialog title={inv ? `Invoice ${inv.number}` : "Invoice"} onClose={onClose} drawer>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      {!inv && !error && <Skeleton height={160} />}
      {inv && (
        <div className={ui.stackSm}>
          <div className={ui.spaceBetween}>
            <Badge tone={STATUS_BADGE[inv.paymentStatus].tone}>{STATUS_BADGE[inv.paymentStatus].text}</Badge>
            <Btn small icon="download" disabled={busy} onClick={() => void download()}>
              Download PDF
            </Btn>
          </div>
          <dl className={ui.kv}>
            <dt>Customer</dt>
            <dd>{inv.customerName ?? "Customer"}{inv.customerPhone ? ` · ${inv.customerPhone}` : ""}</dd>
            <dt>Issued</dt>
            <dd>{formatShopDate(inv.issuedAt, null, true)} {formatShopTime(inv.issuedAt, null)}</dd>
            <dt>Service date</dt>
            <dd>{formatShopDate(inv.serviceDate, null, true)}</dd>
            {inv.staffName && (<><dt>Served by</dt><dd>{inv.staffName}</dd></>)}
            <dt>Billed by</dt>
            <dd>
              {inv.seller.legalName}
              {inv.seller.gstin ? ` · GSTIN ${inv.seller.gstin}` : ""}
            </dd>
          </dl>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className={ui.num}>Qty</th>
                  <th className={ui.num}>Price</th>
                  <th className={ui.num}>Discount</th>
                  <th className={ui.num}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className={ui.num}>{l.quantity}</td>
                    <td className={ui.num}>{money(l.unitPrice)}</td>
                    <td className={ui.num}>{l.discount > 0 ? `-${money(l.discount)}` : "—"}</td>
                    <td className={ui.num}>{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={ui.totals}>
            <div className={ui.totalsRow}><span>Subtotal</span><span>{money(inv.subtotal)}</span></div>
            {inv.discountTotal > 0 && <div className={ui.totalsRow}><span>Discount</span><span>-{money(inv.discountTotal)}</span></div>}
            {inv.taxLabel && inv.taxTotal > 0 && (
              <div className={ui.totalsRow}>
                <span>{inv.taxLabel} {inv.taxRatePercent}%{inv.taxMode === "INCLUSIVE" ? " (included)" : ""}</span>
                <span>{money(inv.taxTotal)}</span>
              </div>
            )}
            <div className={`${ui.totalsRow} ${ui.totalsGrand}`}><span>Total</span><span>{money(inv.total)}</span></div>
            <div className={ui.totalsRow}><span>Received</span><span>{money(inv.amountPaid)}</span></div>
            {inv.amountRefunded > 0 && <div className={ui.totalsRow}><span>Refunded</span><span>-{money(inv.amountRefunded)}</span></div>}
            <div className={ui.totalsRow}><strong>Balance due</strong><strong>{money(inv.balanceDue)}</strong></div>
          </div>

          <h3 className={ui.cardTitle}>Payments recorded</h3>
          {inv.payments.length === 0 ? (
            <div className={ui.hint}>No payment has been recorded yet.</div>
          ) : (
            <ul className={ui.list}>
              {inv.payments.map((p) => (
                <li key={p.id} className={ui.listRow}>
                  <div className={ui.listMain}>
                    <div className={ui.listTitle}>
                      {p.kind === "REFUND" ? "Refund" : "Payment"} · {METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </div>
                    <div className={ui.listSub}>{formatShopDate(p.recordedAt, null, true)} {formatShopTime(p.recordedAt, null)}{p.note ? ` · ${p.note}` : ""}</div>
                  </div>
                  <strong>{p.kind === "REFUND" ? "-" : ""}{money(p.amount)}</strong>
                </li>
              ))}
            </ul>
          )}

          {inv.status === "ISSUED" && (
            <div className={ui.rowWrap}>
              {inv.balanceDue > 0 && (
                <Btn variant="primary" small onClick={() => setMode("payment")}>
                  Record payment
                </Btn>
              )}
              {inv.amountPaid - inv.amountRefunded > 0 && (
                <Btn small onClick={() => setMode("refund")}>
                  Record refund
                </Btn>
              )}
              <Btn small variant="danger" onClick={() => setMode("void")}>
                Void invoice
              </Btn>
            </div>
          )}
          {inv.status === "VOID" && <Banner tone="warn">Voided{inv.voidReason ? `: ${inv.voidReason}` : ""}. The number stays on record and is never reused.</Banner>}

          {mode === "payment" || mode === "refund" ? (
            <PaymentForm
              base={base}
              kind={mode === "refund" ? "REFUND" : "PAYMENT"}
              defaultAmount={mode === "refund" ? inv.amountPaid - inv.amountRefunded : inv.balanceDue}
              currency={inv.currency}
              onCancel={() => setMode(null)}
              onDone={(msg) => {
                setMode(null);
                setNotice(msg);
                reload();
                onChanged();
              }}
            />
          ) : mode === "void" ? (
            <VoidForm
              base={base}
              onCancel={() => setMode(null)}
              onDone={() => {
                setMode(null);
                setNotice("Invoice voided.");
                reload();
                onChanged();
              }}
            />
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function PaymentForm({ base, kind, defaultAmount, currency, onCancel, onDone }: { base: string; kind: "PAYMENT" | "REFUND"; defaultAmount: number; currency: string; onCancel: () => void; onDone: (message: string) => void }) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [method, setMethod] = useState<InvoicePaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newIdempotencyKey());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = recordInvoicePaymentSchema.safeParse({ kind, method, amount: Number(amount), reference, note });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${base}/payments`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(parsed.data) });
      onDone(kind === "REFUND" ? "Refund recorded." : "Payment recorded.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={ui.card} style={{ boxShadow: "none", background: "var(--os-surface-2)" }}>
      <h3 className={ui.cardTitle} style={{ marginBottom: 10 }}>{kind === "REFUND" ? "Record a refund the shop has paid out" : "Record money the shop has received"}</h3>
      {error && <Banner tone="error">{error}</Banner>}
      <div className={ui.formGrid}>
        <Field label={`Amount (${currency})`} htmlFor="pay-amount">
          <input id="pay-amount" className={ui.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method" htmlFor="pay-method">
          <select id="pay-method" className={ui.select} value={method} onChange={(e) => setMethod(e.target.value as InvoicePaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as InvoicePaymentMethod[]).map((m) => (
              <option key={m} value={m}>{METHOD_LABEL[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference (optional)" htmlFor="pay-ref" hint="e.g. the UPI transaction id">
          <input id="pay-ref" className={ui.input} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Note (optional)" htmlFor="pay-note">
          <input id="pay-note" className={ui.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </Field>
      </div>
      <div className={ui.dialogActions}>
        <Btn variant="quiet" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" type="submit" disabled={busy}>{busy ? "Saving…" : kind === "REFUND" ? "Record refund" : "Record payment"}</Btn>
      </div>
    </form>
  );
}

function VoidForm({ base, onCancel, onDone }: { base: string; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = voidInvoiceSchema.safeParse({ reason });
    if (!parsed.success) {
      setError("Give a short reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${base}/void`, { method: "POST", headers: { "Idempotency-Key": newIdempotencyKey() }, body: JSON.stringify(parsed.data) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not void the invoice.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={ui.card} style={{ boxShadow: "none", background: "var(--os-surface-2)" }}>
      <h3 className={ui.cardTitle} style={{ marginBottom: 10 }}>Void this invoice</h3>
      <p className={ui.cardSub}>Use this if the invoice was made in error. If money was received, record a refund first. A new invoice can then be created for the same service.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <Field label="Reason" htmlFor="void-reason">
        <input id="void-reason" className={ui.input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Field>
      <div className={ui.dialogActions}>
        <Btn variant="quiet" onClick={onCancel}>Keep invoice</Btn>
        <Btn variant="danger" type="submit" disabled={busy}>{busy ? "Voiding…" : "Void invoice"}</Btn>
      </div>
    </form>
  );
}

function BillingProfile({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [profile, setProfile] = useState<BillingProfileDto | null>(null);
  const [form, setForm] = useState({ legalName: "", billingAddress: "", contactPhone: "", contactEmail: "", gstin: "", taxEnabled: false, taxLabel: "GST", taxRatePercent: "", taxMode: "EXCLUSIVE" as "EXCLUSIVE" | "INCLUSIVE", invoicePrefix: "INV" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<BillingProfileDto>(`${base}/billing-profile`)
      .then((p) => {
        setProfile(p);
        setForm({
          legalName: p.legalName ?? "",
          billingAddress: p.billingAddress ?? "",
          contactPhone: p.contactPhone ?? "",
          contactEmail: p.contactEmail ?? "",
          gstin: p.gstin ?? "",
          taxEnabled: p.taxEnabled,
          taxLabel: p.taxLabel,
          taxRatePercent: p.taxRatePercent === null ? "" : String(p.taxRatePercent),
          taxMode: p.taxMode,
          invoicePrefix: p.invoicePrefix,
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load billing settings."));
  }, [base]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    const parsed = billingProfileSchema.safeParse({
      legalName: form.legalName,
      billingAddress: form.billingAddress,
      contactPhone: form.contactPhone,
      contactEmail: form.contactEmail,
      gstin: form.gstin.trim() ? form.gstin.trim() : undefined,
      taxEnabled: form.taxEnabled,
      taxLabel: form.taxLabel,
      taxRatePercent: form.taxRatePercent.trim() ? Number(form.taxRatePercent) : undefined,
      taxMode: form.taxMode,
      invoicePrefix: form.invoicePrefix,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<BillingProfileDto>(`${base}/billing-profile`, { method: "PUT", body: JSON.stringify(parsed.data) });
      setProfile(result);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  if (!profile && !error) return <Skeleton height={200} />;
  return (
    <form onSubmit={submit}>
      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="ok">Billing profile saved. New invoices use these details; invoices already issued are never changed.</Banner>}
      {profile && !profile.complete && <Banner tone="info">Add your business name to start issuing invoices. Tax is optional and stays off unless you turn it on.</Banner>}
      <div className={`${ui.grid} ${ui.evenTwo}`}>
        <Card title="Business details" sub="Printed on every invoice">
          <div className={ui.stackSm}>
            <Field label="Legal / business name" htmlFor="bp-name">
              <input id="bp-name" className={ui.input} value={form.legalName} onChange={(e) => set("legalName", e.target.value)} maxLength={160} required />
            </Field>
            <Field label="Billing address" htmlFor="bp-addr">
              <textarea id="bp-addr" className={ui.textarea} value={form.billingAddress} onChange={(e) => set("billingAddress", e.target.value)} maxLength={300} />
            </Field>
            <div className={ui.formGrid}>
              <Field label="Phone" htmlFor="bp-phone"><input id="bp-phone" className={ui.input} value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
              <Field label="E-mail" htmlFor="bp-mail"><input id="bp-mail" type="email" className={ui.input} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
            </div>
          </div>
        </Card>
        <Card title="Tax & numbering" sub="Only what you configure is printed">
          <div className={ui.stackSm}>
            <Field label="GSTIN (optional)" htmlFor="bp-gstin" hint="Checked for format only — FastQue cannot confirm it is registered. Leave blank if you are not GST-registered.">
              <input id="bp-gstin" className={ui.input} value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} placeholder="22AAAAA0000A1Z5" />
            </Field>
            <label className={ui.checkRow}>
              <input type="checkbox" checked={form.taxEnabled} onChange={(e) => set("taxEnabled", e.target.checked)} />
              <span>Charge tax on invoices</span>
            </label>
            {form.taxEnabled && (
              <div className={ui.formGrid}>
                <Field label="Tax name" htmlFor="bp-label"><input id="bp-label" className={ui.input} value={form.taxLabel} onChange={(e) => set("taxLabel", e.target.value)} maxLength={20} /></Field>
                <Field label="Rate (%)" htmlFor="bp-rate"><input id="bp-rate" className={ui.input} inputMode="decimal" value={form.taxRatePercent} onChange={(e) => set("taxRatePercent", e.target.value)} placeholder="18" /></Field>
                <Field label="Your listed prices" htmlFor="bp-mode" hint={form.taxMode === "EXCLUSIVE" ? "Tax is added on top of the listed price." : "Listed prices already include tax; it is shown as part of the total."}>
                  <select id="bp-mode" className={ui.select} value={form.taxMode} onChange={(e) => set("taxMode", e.target.value as "EXCLUSIVE" | "INCLUSIVE")}>
                    <option value="EXCLUSIVE">Exclude tax (add it on top)</option>
                    <option value="INCLUSIVE">Include tax</option>
                  </select>
                </Field>
              </div>
            )}
            <Field label="Invoice number prefix" htmlFor="bp-prefix" hint={`Numbers run in order per shop, e.g. ${form.invoicePrefix || "INV"}-000001.`}>
              <input id="bp-prefix" className={ui.input} value={form.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())} maxLength={8} style={{ maxWidth: 160 }} />
            </Field>
          </div>
        </Card>
      </div>
      <div className={`${ui.rowWrap} ${ui.mt16}`}>
        <Btn variant="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save billing profile"}
        </Btn>
      </div>
    </form>
  );
}
