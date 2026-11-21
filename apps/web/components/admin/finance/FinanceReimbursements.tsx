"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FINANCE_REIMBURSEMENT_STATUS_LABEL,
  FinancePaymentMethod,
  sumMoney,
  type FinanceAccountDto,
  type FinanceClaimablePaymentDto,
  type FinanceMeDto,
  type FinanceReimbursementDto,
  type FinanceReimbursementStatus,
} from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, Skeleton, type BadgeTone } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import css from "./finance.module.css";
import { FIN, errorText, inr, newRequestId, pretty, today } from "./finance-ui";

const TONE: Record<FinanceReimbursementStatus, BadgeTone> = {
  SUBMITTED: "info",
  UNDER_REVIEW: "info",
  APPROVED: "warn",
  PARTIALLY_REIMBURSED: "warn",
  FULLY_REIMBURSED: "ok",
  REJECTED: "bad",
  CANCELLED: "neutral",
};

export function FinanceReimbursements({ me }: { me: FinanceMeDto }) {
  const [items, setItems] = useState<FinanceReimbursementDto[] | null>(null);
  const [claimable, setClaimable] = useState<FinanceClaimablePaymentDto[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccountDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<FinanceClaimablePaymentDto | null>(null);
  const [paying, setPaying] = useState<FinanceReimbursementDto | null>(null);
  const [status, setStatus] = useState<"open" | "all">("open");

  const load = useCallback(() => {
    apiFetch<FinanceReimbursementDto[]>(`${FIN}/reimbursements`).then(setItems).catch((err) => setError(errorText(err)));
    apiFetch<FinanceClaimablePaymentDto[]>(`${FIN}/reimbursements/claimable`).then(setClaimable).catch(() => undefined);
    if (me.roles.manage) apiFetch<FinanceAccountDto[]>(`${FIN}/accounts`).then(setAccounts).catch(() => undefined);
  }, [me.roles.manage]);
  useEffect(load, [load]);

  const visible = (items ?? []).filter((r) => status === "all" || !["FULLY_REIMBURSED", "REJECTED", "CANCELLED"].includes(r.status));
  const byPerson = useMemo(() => {
    const map = new Map<string, { name: string; owed: string[]; review: string[] }>();
    for (const r of items ?? []) {
      const row = map.get(r.requestedBy.id) ?? { name: r.requestedBy.name, owed: [], review: [] };
      if (["APPROVED", "PARTIALLY_REIMBURSED"].includes(r.status)) row.owed.push(r.remaining);
      if (["SUBMITTED", "UNDER_REVIEW"].includes(r.status)) row.review.push(r.amountRequested);
      map.set(r.requestedBy.id, row);
    }
    return [...map.values()].filter((p) => p.owed.length || p.review.length);
  }, [items]);

  async function act(path: string, body: unknown, done: string) {
    setError(null);
    try {
      await apiFetch(`${FIN}/${path}`, { method: "POST", body: JSON.stringify(body) });
      setNotice(done);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const ask = (q: string, initial = "") => {
    const v = window.prompt(q, initial);
    return v === null ? null : v.trim();
  };

  return (
    <>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <Card title="Ready to claim" sub="Payments made from personal money and marked “to be reimbursed”, with no claim yet. Expenses recorded as a reimbursement claim are claimed automatically when submitted; company expenses never appear here.">
        {claimable.length === 0 ? <p className={ui.hint}>Nothing waiting to be claimed.</p> : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Paid on</th><th>Paid by</th><th>Expense</th><th className={ui.num}>Amount</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {claimable.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paidOn}</td><td>{p.contributor.name}</td><td>{p.expense.number} · {p.expense.description}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(p.amount)}</td>
                    <td><Btn small variant="primary" onClick={() => setClaiming(p)}>Claim</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {me.roles.viewCompany && byPerson.length > 0 && (
        <Card title="Outstanding by person" tight>
          <ul className={css.breakdown}>
            {byPerson.map((p) => (
              <li key={p.name} className={css.breakdownRow}>
                <span>{p.name}</span>
                <span className={ui.hint}>Under review {inr(sumMoney(p.review.length ? p.review : ["0"]))}</span>
                <span className={css.breakdownValue}>Owed {inr(sumMoney(p.owed.length ? p.owed : ["0"]))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={me.roles.viewCompany ? "Reimbursement claims" : "My claims"}
        action={
          <div className={ui.rowWrap}>
            <Btn small variant={status === "open" ? "primary" : "secondary"} onClick={() => setStatus("open")}>Open</Btn>
            <Btn small variant={status === "all" ? "primary" : "secondary"} onClick={() => setStatus("all")}>All</Btn>
          </div>
        }
      >
        {!items ? <Skeleton height={120} /> : visible.length === 0 ? <EmptyState title="No claims here" /> : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Claim</th><th>Requested by</th><th>Expense</th><th className={ui.num}>Requested</th><th className={ui.num}>Approved</th><th className={ui.num}>Reimbursed</th><th className={ui.num}>Remaining</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>{r.number}<div className={ui.cardSub}>{new Date(r.submittedAt).toLocaleDateString("en-IN")}</div></td>
                    <td>{r.requestedBy.name}</td>
                    <td>{r.expense.number}<div className={ui.cardSub}>{r.expense.description}</div></td>
                    <td className={`${ui.num} ${css.money}`}>{inr(r.amountRequested)}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(r.amountApproved)}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(r.amountReimbursed)}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(r.remaining)}</td>
                    <td><Badge tone={TONE[r.status]}>{FINANCE_REIMBURSEMENT_STATUS_LABEL[r.status]}</Badge>{r.reviewNote && <div className={css.changes}>{r.reviewNote}</div>}</td>
                    <td className={ui.rowWrap}>
                      {r.can.review && r.status === "SUBMITTED" && <Btn small variant="quiet" onClick={() => void act(`reimbursements/${r.id}/review`, { action: "START_REVIEW" }, "Marked under review.")}>Start review</Btn>}
                      {r.can.review && (
                        <Btn small variant="primary" onClick={() => {
                          const amount = ask(`Approve how much? (requested ${inr(r.amountRequested)})`, r.amountRequested);
                          if (amount) void act(`reimbursements/${r.id}/review`, { action: "APPROVE", amountApproved: amount }, "Approved.");
                        }}>Approve</Btn>
                      )}
                      {r.can.review && <Btn small variant="danger" onClick={() => { const note = ask("Why is this claim rejected?"); if (note && note.length >= 3) void act(`reimbursements/${r.id}/review`, { action: "REJECT", note }, "Rejected."); }}>Reject</Btn>}
                      {r.can.pay && <Btn small variant="primary" onClick={() => setPaying(r)}>Pay out</Btn>}
                      {r.can.cancel && <Btn small variant="quiet" onClick={() => { const reason = ask("Why cancel this claim?"); if (reason && reason.length >= 3) void act(`reimbursements/${r.id}/cancel`, { reason }, "Claim cancelled."); }}>Cancel</Btn>}
                      {me.roles.manage && r.payouts.filter((p) => !p.voided).map((p) => (
                        <Btn key={p.id} small variant="quiet" onClick={() => { const reason = ask(`Void the ${inr(p.amount)} payout of ${p.paidOn}? Reason:`); if (reason && reason.length >= 3) void act(`payouts/${p.id}/void`, { reason }, "Payout voided."); }}>Void {inr(p.amount)} payout</Btn>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={ui.hint}>Payouts settle the amount owed. They are not a second expense: the expense was already counted once.</p>
      </Card>

      {claiming && <ClaimForm payment={claiming} onClose={() => setClaiming(null)} onSaved={() => (setClaiming(null), setNotice("Claim submitted."), load())} />}
      {paying && <PayoutForm claim={paying} accounts={accounts} onClose={() => setPaying(null)} onSaved={() => (setPaying(null), setNotice("Payout recorded."), load())} />}
    </>
  );
}

function ClaimForm({ payment, onClose, onSaved }: { payment: FinanceClaimablePaymentDto; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(payment.amount);
  const [note, setNote] = useState("");
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${FIN}/reimbursements`, { method: "POST", body: JSON.stringify({ expensePaymentId: payment.id, amountRequested: amount, note: note || undefined, clientRequestId: requestId }) });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not submit the claim."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Claim for ${payment.expense.number}`} onClose={onClose}>
      {error && <Banner tone="error">{error}</Banner>}
      <p>{payment.expense.description} · paid {inr(payment.amount)} on {payment.paidOn} by {payment.contributor.name}</p>
      <div className={ui.formGrid}>
        <Field label="Amount to claim (₹)" htmlFor="cl-amount"><input id="cl-amount" inputMode="decimal" className={ui.input} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <div className={css.formWide}><Field label="Note" htmlFor="cl-note"><textarea id="cl-note" className={ui.textarea} rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field></div>
      </div>
      <div className={ui.dialogActions}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void save()}>{busy ? "Submitting…" : "Submit claim"}</Btn>
      </div>
    </Dialog>
  );
}

function PayoutForm({ claim, accounts, onClose, onSaved }: { claim: FinanceReimbursementDto; accounts: FinanceAccountDto[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: claim.remaining, paidOn: today(), accountId: accounts.find((a) => a.isActive)?.id ?? "", method: "UPI", reference: "" });
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${FIN}/reimbursements/${claim.id}/payouts`, { method: "POST", body: JSON.stringify({ ...f, reference: f.reference || undefined, clientRequestId: requestId }) });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not record the payout."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Pay out ${claim.number}`} onClose={onClose}>
      {error && <Banner tone="error">{error}</Banner>}
      <p>{claim.requestedBy.name} · {inr(claim.remaining)} remaining of {inr(claim.amountApproved)} approved. Partial payouts are fine.</p>
      <div className={ui.formGrid}>
        <Field label="Amount (₹)" htmlFor="po-amount"><input id="po-amount" inputMode="decimal" className={ui.input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Paid on" htmlFor="po-date"><input id="po-date" type="date" className={ui.input} value={f.paidOn} max={today()} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label="From company account" htmlFor="po-acc" hint={accounts.length ? undefined : "Add a company account in Settings first."}>
          <select id="po-acc" className={ui.select} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choose…</option>
            {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Method" htmlFor="po-method">
          <select id="po-method" className={ui.select} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {Object.values(FinancePaymentMethod).map((m) => <option key={m} value={m}>{pretty(m)}</option>)}
          </select>
        </Field>
        <Field label="Transaction reference" htmlFor="po-ref"><input id="po-ref" className={ui.input} value={f.reference} maxLength={120} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <div className={ui.dialogActions}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || !f.accountId || !(Number(f.amount) > 0)} onClick={() => void save()}>{busy ? "Saving…" : "Record payout"}</Btn>
      </div>
    </Dialog>
  );
}
