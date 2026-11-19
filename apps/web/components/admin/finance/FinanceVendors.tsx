"use client";

import { useCallback, useEffect, useState } from "react";
import type { FinanceMeDto, FinanceVendorDto } from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, Skeleton } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import css from "./finance.module.css";
import { FIN, errorText, inr } from "./finance-ui";

export function FinanceVendors({ me }: { me: FinanceMeDto }) {
  const [vendors, setVendors] = useState<FinanceVendorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinanceVendorDto | "new" | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(() => {
    apiFetch<FinanceVendorDto[]>(`${FIN}/vendors`).then(setVendors).catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);
  const shown = (vendors ?? []).filter((v) => !q || `${v.name} ${v.category ?? ""} ${v.gstin ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      {error && <Banner tone="error">{error}</Banner>}
      <Card
        title="Vendors"
        sub="Payees of FastQue expenses. Totals count approved expenses only."
        action={me.roles.manage ? <Btn small variant="primary" icon="plus" onClick={() => setEditing("new")}>Add vendor</Btn> : undefined}
      >
        <Field label="Search" htmlFor="fv-q"><input id="fv-q" type="search" className={ui.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, category, GSTIN…" /></Field>
        {!vendors ? <Skeleton height={100} /> : shown.length === 0 ? <EmptyState title="No vendors yet" /> : (
          <div className={`${ui.tableWrap} ${ui.mt12}`}>
            <table className={ui.table}>
              <thead><tr><th>Vendor</th><th>Contact</th><th>GSTIN</th><th>Terms</th><th className={ui.num}>Paid</th><th className={ui.num}>Outstanding</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.id}>
                    <td><span className={css.rowTitle}>{v.name}</span><div className={ui.cardSub}>{v.category ?? ""} · {v.expenseCount} expense(s)</div></td>
                    <td>{v.contactPerson ?? "—"}<div className={ui.cardSub}>{[v.phone, v.email].filter(Boolean).join(" · ")}</div></td>
                    <td>{v.gstin ?? "—"}</td>
                    <td>{v.paymentTerms ?? "—"}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(v.totalPaid)}</td>
                    <td className={`${ui.num} ${css.money}`}>{inr(v.outstanding)}</td>
                    <td>{v.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td>{me.roles.manage && <Btn small variant="quiet" onClick={() => setEditing(v)}>Edit</Btn>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={ui.hint}>To see a vendor&apos;s invoices, filter the Expenses tab by vendor name.</p>
      </Card>
      {editing && <VendorForm me={me} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />}
    </>
  );
}

function VendorForm({ me, initial, onClose, onSaved }: { me: FinanceMeDto; initial: FinanceVendorDto | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "",
    category: initial?.category ?? "",
    contactPerson: initial?.contactPerson ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    address: initial?.address ?? "",
    gstin: initial?.gstin ?? "",
    paymentTerms: initial?.paymentTerms ?? "",
    bankDetails: initial?.bankDetails ?? "",
    isActive: initial?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    const { bankDetails, ...rest } = f;
    try {
      await apiFetch(initial ? `${FIN}/vendors/${initial.id}` : `${FIN}/vendors`, {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify(me.roles.bankDetails ? { ...rest, bankDetails } : rest),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not save the vendor."));
    } finally {
      setBusy(false);
    }
  }
  const text = (k: keyof typeof f, label: string, max: number) => (
    <Field label={label} htmlFor={`vf-${k}`}>
      <input id={`vf-${k}`} className={ui.input} value={String(f[k])} maxLength={max} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Dialog title={initial ? `Edit ${initial.name}` : "Add vendor"} onClose={onClose} wide>
      {error && <Banner tone="error">{error}</Banner>}
      <div className={ui.formGrid}>
        {text("name", "Vendor name *", 160)}
        {text("category", "Vendor category", 80)}
        {text("contactPerson", "Contact person", 120)}
        {text("phone", "Mobile number", 20)}
        {text("email", "Email", 200)}
        {text("gstin", "GSTIN", 15)}
        {text("paymentTerms", "Payment terms", 120)}
        <div className={css.formWide}>{text("address", "Address", 400)}</div>
        {me.roles.bankDetails && (
          <div className={css.formWide}>
            <Field label="Bank details (restricted)" htmlFor="vf-bank" hint="Visible only to platform admins.">
              <textarea id="vf-bank" className={ui.textarea} rows={2} value={f.bankDetails} maxLength={400} onChange={(e) => setF({ ...f, bankDetails: e.target.value })} />
            </Field>
          </div>
        )}
      </div>
      {initial && <label className={`${ui.checkRow} ${ui.mt12}`}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>Active</span></label>}
      <div className={ui.dialogActions}>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy || f.name.trim().length < 2} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Dialog>
  );
}
