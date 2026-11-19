"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FINANCE_DEPARTMENTS,
  FinanceAccountType,
  type FinanceAccountDto,
  type FinanceCategoryDto,
  type FinanceMeDto,
} from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, Skeleton } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import css from "./finance.module.css";
import { FIN, errorText, inr, pretty, today } from "./finance-ui";

export function FinanceSettings({ me }: { me: FinanceMeDto }) {
  const [accounts, setAccounts] = useState<FinanceAccountDto[] | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<FinanceAccountDto | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<FinanceAccountDto[]>(`${FIN}/accounts`).then(setAccounts).catch((err) => setError(errorText(err)));
    apiFetch<FinanceCategoryDto[]>(`${FIN}/categories`).then(setCategories).catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  async function call(path: string, method: "POST" | "PATCH", body: unknown, done: string) {
    setError(null);
    try {
      await apiFetch(`${FIN}/${path}`, { method, body: JSON.stringify(body) });
      setNotice(done);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }
  const askName = (q: string, initial = "") => {
    const v = window.prompt(q, initial);
    return v && v.trim().length >= 2 ? v.trim() : null;
  };

  return (
    <>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <Card
        title="Company accounts"
        sub="FastQue&apos;s own bank, cash and wallet accounts. Available cash is calculated from these: opening balance plus every recorded movement."
        action={me.roles.configure ? <Btn small variant="primary" icon="plus" onClick={() => setEditingAccount("new")}>Add account</Btn> : undefined}
      >
        {!accounts ? <Skeleton height={80} /> : accounts.length === 0 ? (
          <EmptyState title="No company accounts yet">Add FastQue&apos;s bank account with its opening balance to start tracking actual cash.</EmptyState>
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Account</th><th>Type</th><th className={ui.num}>Opening balance</th><th className={ui.num}>Current balance</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td><span className={css.rowTitle}>{a.name}</span><div className={ui.cardSub}>{[a.institution, a.accountLast4 ? `••${a.accountLast4}` : null].filter(Boolean).join(" · ")}</div></td>
                    <td>{pretty(a.type.replace("COMPANY_", ""))}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(a.openingBalance)}<div className={ui.cardSub}>as of {a.openingBalanceDate}</div></td>
                    <td className={`${ui.num} ${css.money}`}><strong>{inr(a.balance)}</strong></td>
                    <td>{a.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td>{me.roles.configure && <Btn small variant="quiet" onClick={() => setEditingAccount(a)}>Edit</Btn>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Expense categories"
        sub="FastQue's standard categories. Platform admins can add main categories; finance managers can add subcategories."
        action={me.roles.configure ? (
          <Btn small variant="primary" icon="plus" onClick={() => { const name = askName("New main category name"); if (name) void call("categories", "POST", { name }, "Category added."); }}>Add category</Btn>
        ) : undefined}
      >
        {!categories ? <Skeleton height={120} /> : (
          <ul className={css.timeline}>
            {categories.map((c) => (
              <li key={c.id}>
                <button type="button" className={css.rowButton} aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <span className={css.rowTitle}>{c.name}</span>
                </button>{" "}
                <span className={ui.hint}>{c.subcategories.length} subcategories · {c.department ?? "no department"}</span>{" "}
                {!c.isActive && <Badge>Inactive</Badge>}
                {open === c.id && (
                  <div className={ui.mt12}>
                    <div className={ui.rowWrap}>
                      {c.subcategories.map((s) => (
                        <span key={s.id} className={ui.badge} style={s.isActive ? undefined : { opacity: 0.5 }}>
                          {s.name}
                          {me.roles.configure && (
                            <button type="button" className={css.rowButton} aria-label={`${s.isActive ? "Deactivate" : "Activate"} ${s.name}`} title={s.isActive ? "Deactivate" : "Activate"} onClick={() => void call(`categories/${s.id}`, "PATCH", { isActive: !s.isActive }, s.isActive ? "Subcategory deactivated." : "Subcategory activated.")} style={{ marginLeft: 6 }}>
                              {s.isActive ? "×" : "↺"}
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    <div className={`${ui.rowWrap} ${ui.mt12}`}>
                      {me.roles.manage && <Btn small onClick={() => { const name = askName(`New subcategory under ${c.name}`); if (name) void call("categories", "POST", { name, parentId: c.id }, "Subcategory added."); }}>Add subcategory</Btn>}
                      {me.roles.configure && <Btn small variant="quiet" onClick={() => { const name = askName("Rename category", c.name); if (name) void call(`categories/${c.id}`, "PATCH", { name }, "Renamed."); }}>Rename</Btn>}
                      {me.roles.configure && (
                        <label className={ui.hint}>
                          Department{" "}
                          <select className={ui.select} value={c.department ?? ""} onChange={(e) => void call(`categories/${c.id}`, "PATCH", { department: e.target.value }, "Department updated.")}>
                            <option value="">None</option>
                            {FINANCE_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </label>
                      )}
                      {me.roles.configure && <Btn small variant="quiet" onClick={() => void call(`categories/${c.id}`, "PATCH", { isActive: !c.isActive }, c.isActive ? "Category deactivated." : "Category activated.")}>{c.isActive ? "Deactivate" : "Activate"}</Btn>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className={ui.hint}>Categories are never deleted, so past expenses keep their classification; deactivate instead.</p>
      </Card>

      <Card title="Permissions" tight>
        <ul className={css.timeline}>
          <li><strong>Platform admin</strong> — everything, including company accounts, categories and bank details.</li>
          <li><strong>Co-founder</strong> — all finance records, funding, approvals and reports (cannot approve their own entries).</li>
          <li><strong>HR, Sales and Viewer admins</strong> — only their own expenses, receipts and reimbursement claims.</li>
        </ul>
        <p className={ui.hint}>A dedicated Finance Admin role and territory-scoped Sales Manager view are planned; today those people use the roles above.</p>
      </Card>

      {editingAccount && <AccountForm initial={editingAccount === "new" ? null : editingAccount} onClose={() => setEditingAccount(null)} onSaved={() => (setEditingAccount(null), setNotice("Account saved."), load())} />}
    </>
  );
}

function AccountForm({ initial, onClose, onSaved }: { initial: FinanceAccountDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "",
    type: initial?.type ?? "COMPANY_BANK",
    institution: initial?.institution ?? "",
    accountLast4: initial?.accountLast4 ?? "",
    openingBalance: initial?.openingBalance ?? "0",
    openingBalanceDate: initial?.openingBalanceDate ?? today(),
    isActive: initial?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(initial ? `${FIN}/accounts/${initial.id}` : `${FIN}/accounts`, {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify({ ...f, institution: f.institution || undefined, accountLast4: f.accountLast4 || undefined }),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not save the account."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={initial ? `Edit ${initial.name}` : "Add company account"} onClose={onClose}>
      {error && <Banner tone="error">{error}</Banner>}
      <div className={ui.formGrid}>
        <Field label="Account name *" htmlFor="af-name"><input id="af-name" className={ui.input} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. FastQue current account" /></Field>
        <Field label="Type *" htmlFor="af-type">
          <select id="af-type" className={ui.select} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as FinanceAccountDto["type"] })}>
            {Object.values(FinanceAccountType).map((t) => <option key={t} value={t}>{pretty(t.replace("COMPANY_", ""))}</option>)}
          </select>
        </Field>
        <Field label="Bank / provider" htmlFor="af-inst"><input id="af-inst" className={ui.input} value={f.institution} maxLength={120} onChange={(e) => setF({ ...f, institution: e.target.value })} /></Field>
        <Field label="Last 4 digits" htmlFor="af-last4" hint="Never the full account number."><input id="af-last4" inputMode="numeric" className={ui.input} value={f.accountLast4} maxLength={4} onChange={(e) => setF({ ...f, accountLast4: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Opening balance (₹)" htmlFor="af-open"><input id="af-open" inputMode="decimal" className={ui.input} value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} /></Field>
        <Field label="Balance as of" htmlFor="af-date"><input id="af-date" type="date" className={ui.input} value={f.openingBalanceDate} onChange={(e) => setF({ ...f, openingBalanceDate: e.target.value })} /></Field>
      </div>
      {initial && <label className={`${ui.checkRow} ${ui.mt12}`}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>Active</span></label>}
      <div className={ui.dialogActions}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || f.name.trim().length < 2} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Dialog>
  );
}
