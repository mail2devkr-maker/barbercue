"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  FINANCE_FUNDING_CLASSIFICATION_LABEL,
  FINANCE_PERSONAL_TREATMENT_LABEL,
  FinanceContributorType,
  FinanceFundingClassification,
  FinancePaymentMethod,
  type FinanceAccountDto,
  type FinanceContributorDto,
  type FinanceContributorLedgerDto,
  type FinanceFundingDto,
  type FinanceMeDto,
} from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, Skeleton } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import css from "./finance.module.css";
import { FIN, errorText, inr, newRequestId, pretty, today } from "./finance-ui";

export function FinanceFunding({ me }: { me: FinanceMeDto }) {
  const [contributors, setContributors] = useState<FinanceContributorDto[] | null>(null);
  const [funding, setFunding] = useState<FinanceFundingDto[] | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccountDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinanceContributorDto | "new" | null>(null);
  const [recording, setRecording] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<FinanceContributorDto[]>(`${FIN}/contributors`).then(setContributors).catch((err) => setError(errorText(err)));
    apiFetch<FinanceFundingDto[]>(`${FIN}/funding`).then(setFunding).catch((err) => setError(errorText(err)));
    apiFetch<FinanceAccountDto[]>(`${FIN}/accounts`).then(setAccounts).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function voidFunding(f: FinanceFundingDto) {
    const reason = window.prompt(`Void ${f.number} (${inr(f.amount)})? It stays in the history. Reason:`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiFetch(`${FIN}/funding/${f.id}/void`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <>
      {error && <Banner tone="error">{error}</Banner>}
      <Banner tone="info">
        Funding is money received into a FastQue company account. It is never revenue, and it is never treated as equity unless your accountant classifies it as share capital. Ownership comes from share allotment records, not from money contributed. Expenses a person paid from their own pocket are recorded on the expense, not here.
      </Banner>

      <Card title="Contributors" sub="Founders, directors, investors, partners and team members who fund FastQue or pay its expenses." action={me.roles.manage ? <Btn small variant="primary" icon="plus" onClick={() => setEditing("new")}>Add contributor</Btn> : undefined}>
        {!contributors ? <Skeleton height={80} /> : contributors.length === 0 ? <EmptyState title="No contributors yet" /> : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Name</th><th>Type</th><th>Platform user</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.id}>
                    <td><button type="button" className={css.rowButton} onClick={() => setLedgerFor(c.id)}><span className={css.rowTitle}>{c.name}</span></button></td>
                    <td>{pretty(c.type)}</td>
                    <td>{c.userEmail ?? <span className={ui.mutedCell}>Not a platform user</span>}</td>
                    <td>{c.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td className={ui.rowWrap}>
                      <Btn small variant="quiet" onClick={() => setLedgerFor(c.id)}>Ledger</Btn>
                      {me.roles.manage && <Btn small variant="quiet" onClick={() => setEditing(c)}>Edit</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Funding & repayments" action={me.roles.manage ? <Btn small variant="primary" icon="plus" disabled={!contributors?.length || !accounts.length} onClick={() => setRecording(true)}>Record funding</Btn> : undefined} sub={!accounts.length ? "Add a company account in Settings & Categories first." : undefined}>
        {!funding ? <Skeleton height={80} /> : funding.length === 0 ? <EmptyState title="No funding recorded yet" /> : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Date</th><th>Contributor</th><th>Type</th><th>Classification</th><th className={ui.num}>Amount</th><th>Account</th><th>Reference</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {funding.map((f) => (
                  <tr key={f.id} style={f.voided ? { opacity: 0.55 } : undefined}>
                    <td className={css.money}>{f.date}<div className={ui.cardSub}>{f.number}</div></td>
                    <td>{f.contributor.name}</td>
                    <td>{f.kind === "CONTRIBUTION" ? <Badge tone="ok">Received</Badge> : <Badge tone="warn">Repaid by FastQue</Badge>}</td>
                    <td>{FINANCE_FUNDING_CLASSIFICATION_LABEL[f.classification]}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(f.amount)}</td>
                    <td>{f.account.name}<div className={ui.cardSub}>{pretty(f.method)}</div></td>
                    <td>{f.reference ?? "—"}{f.voided && <div className={css.changes}>Voided: {f.voidReason}</div>}</td>
                    <td>{me.roles.manage && !f.voided && <Btn small variant="quiet" onClick={() => void voidFunding(f)}>Void</Btn>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <ContributorForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />}
      {recording && contributors && <FundingForm contributors={contributors} accounts={accounts} onClose={() => setRecording(false)} onSaved={() => (setRecording(false), load())} />}
      {ledgerFor && <LedgerDrawer contributorId={ledgerFor} onClose={() => setLedgerFor(null)} />}
    </>
  );
}

function ContributorForm({ initial, onClose, onSaved }: { initial: FinanceContributorDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "",
    type: initial?.type ?? "FOUNDER",
    userEmail: initial?.userEmail ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    notes: initial?.notes ?? "",
    isActive: initial?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(initial ? `${FIN}/contributors/${initial.id}` : `${FIN}/contributors`, { method: initial ? "PATCH" : "POST", body: JSON.stringify(f) });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={initial ? `Edit ${initial.name}` : "Add contributor"} onClose={onClose}>
      {error && <Banner tone="error">{error}</Banner>}
      <div className={ui.formGrid}>
        <Field label="Name *" htmlFor="cf-name"><input id="cf-name" className={ui.input} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type *" htmlFor="cf-type">
          <select id="cf-type" className={ui.select} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as FinanceContributorDto["type"] })}>
            {Object.values(FinanceContributorType).map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
          </select>
        </Field>
        <Field label="FastQue login email (optional)" htmlFor="cf-user" hint="Links an existing platform user, so they see their own ledger and claims. One contributor per user.">
          <input id="cf-user" type="email" className={ui.input} value={f.userEmail} onChange={(e) => setF({ ...f, userEmail: e.target.value })} />
        </Field>
        <Field label="Contact email" htmlFor="cf-email"><input id="cf-email" type="email" className={ui.input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="cf-phone"><input id="cf-phone" className={ui.input} value={f.phone} maxLength={20} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div className={css.formWide}><Field label="Notes" htmlFor="cf-notes"><textarea id="cf-notes" className={ui.textarea} rows={2} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      </div>
      {initial && <label className={`${ui.checkRow} ${ui.mt12}`}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>Active</span></label>}
      <div className={ui.dialogActions}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || f.name.trim().length < 2} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Dialog>
  );
}

function FundingForm({ contributors, accounts, onClose, onSaved }: { contributors: FinanceContributorDto[]; accounts: FinanceAccountDto[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    contributorId: "",
    kind: "CONTRIBUTION",
    classification: "UNCLASSIFIED",
    date: today(),
    amount: "",
    accountId: accounts.find((a) => a.isActive)?.id ?? "",
    method: "BANK_TRANSFER",
    sourceAccount: "",
    reference: "",
    purpose: "",
    remarks: "",
  });
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${FIN}/funding`, {
        method: "POST",
        body: JSON.stringify({
          ...f,
          sourceAccount: f.sourceAccount || undefined,
          reference: f.reference || undefined,
          purpose: f.purpose || undefined,
          remarks: f.remarks || undefined,
          clientRequestId: requestId,
        }),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Record funding" onClose={onClose} wide>
      {error && <Banner tone="error">{error}</Banner>}
      <div className={ui.formGrid}>
        <Field label="Contributor *" htmlFor="ff-who">
          <select id="ff-who" className={ui.select} value={f.contributorId} onChange={(e) => setF({ ...f, contributorId: e.target.value })}>
            <option value="">Choose…</option>
            {contributors.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Direction *" htmlFor="ff-kind">
          <select id="ff-kind" className={ui.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="CONTRIBUTION">Received by FastQue</option>
            <option value="REPAYMENT">Repaid by FastQue to the contributor</option>
          </select>
        </Field>
        <Field label="Classification *" htmlFor="ff-class" hint="Confirm with your accountant. Leave unclassified if unsure — it is never assumed to be equity.">
          <select id="ff-class" className={ui.select} value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })}>
            {Object.values(FinanceFundingClassification).map((c) => <option key={c} value={c}>{FINANCE_FUNDING_CLASSIFICATION_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Date *" htmlFor="ff-date"><input id="ff-date" type="date" className={ui.input} value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Amount (₹) *" htmlFor="ff-amount"><input id="ff-amount" inputMode="decimal" className={ui.input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={f.kind === "CONTRIBUTION" ? "Received into (company account) *" : "Paid from (company account) *"} htmlFor="ff-acc">
          <select id="ff-acc" className={ui.select} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Method *" htmlFor="ff-method">
          <select id="ff-method" className={ui.select} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {Object.values(FinancePaymentMethod).map((m) => <option key={m} value={m}>{pretty(m)}</option>)}
          </select>
        </Field>
        <Field label="Source account (sender's bank, last digits)" htmlFor="ff-src"><input id="ff-src" className={ui.input} value={f.sourceAccount} maxLength={120} onChange={(e) => setF({ ...f, sourceAccount: e.target.value })} /></Field>
        <Field label="Transaction reference" htmlFor="ff-ref"><input id="ff-ref" className={ui.input} value={f.reference} maxLength={120} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Purpose" htmlFor="ff-purpose"><input id="ff-purpose" className={ui.input} value={f.purpose} maxLength={300} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
        <div className={css.formWide}><Field label="Remarks" htmlFor="ff-remarks"><textarea id="ff-remarks" className={ui.textarea} rows={2} value={f.remarks} maxLength={500} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field></div>
      </div>
      <div className={ui.dialogActions}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || !f.contributorId || !f.accountId || !(Number(f.amount) > 0)} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Dialog>
  );
}

export function LedgerDrawer({ contributorId, onClose }: { contributorId: string; onClose: () => void }) {
  const [l, setL] = useState<FinanceContributorLedgerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<FinanceContributorLedgerDto>(`${FIN}/contributors/${contributorId}/ledger`).then(setL).catch((err) => setError(errorText(err)));
  }, [contributorId]);
  const t = l?.totals;
  return (
    <Dialog title={l ? `${l.contributor.name} · ledger` : "Ledger"} onClose={onClose} drawer>
      {error && <Banner tone="error">{error}</Banner>}
      {!l || !t ? <Skeleton height={240} /> : (
        <div className={ui.stackSm}>
          <dl className={ui.kv}>
            <dt>Total contributed</dt><dd><strong>{inr(t.totalContributed)}</strong> (funding + expenses paid personally)</dd>
            <dt>Received into FastQue</dt><dd>{inr(t.fundedIntoCompany)}</dd>
            {Object.entries(t.byClassification).map(([k, v]) => (<Fragment key={k}><dt>· {FINANCE_FUNDING_CLASSIFICATION_LABEL[k as keyof typeof FINANCE_FUNDING_CLASSIFICATION_LABEL]}</dt><dd>{inr(v)}</dd></Fragment>))}
            <dt>Paid personally for FastQue</dt><dd>{inr(t.paidPersonally)}</dd>
            {Object.entries(t.paidPersonallyByTreatment).map(([k, v]) => (<Fragment key={k}><dt>· {FINANCE_PERSONAL_TREATMENT_LABEL[k as keyof typeof FINANCE_PERSONAL_TREATMENT_LABEL]}</dt><dd>{inr(v)}</dd></Fragment>))}
            <dt>Reimbursements outstanding</dt><dd>{inr(t.reimbursementOutstanding)} (reimbursed so far {inr(t.reimbursed)})</dd>
            <dt>Loan / advance balance</dt><dd>{inr(t.loanBalance)} (repaid {inr(t.repaid)})</dd>
            <dt>Net owed by FastQue</dt><dd><strong>{inr(t.netOwedByCompany)}</strong></dd>
          </dl>
          <p className={ui.hint}>Ownership is not shown: it comes from share allotment records, never from money contributed.</p>
          <Card title="History" tight>
            {l.entries.length === 0 ? <p className={ui.hint}>Nothing recorded yet.</p> : (
              <ul className={css.timeline}>
                {l.entries.map((e, i) => (
                  <li key={i}>
                    <strong>{inr(e.amount)}</strong> · {e.date} · {e.kind === "FUNDING_IN" ? "Funds received" : e.kind === "REPAYMENT" ? "Repaid by FastQue" : e.kind === "PERSONAL_PAYMENT" ? "Paid personally" : "Reimbursed"}
                    <div className={css.changes}>{e.description} · {e.label}{e.reference ? ` · ${e.reference}` : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Dialog>
  );
}
