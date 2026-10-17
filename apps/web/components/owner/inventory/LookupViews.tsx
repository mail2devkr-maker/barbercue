"use client";

import { useState } from "react";
import { INVENTORY_PATHS } from "@barbercue/shared";
import type { InventoryCategoryDto, InventorySupplierDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { EMPTY_SUPPLIER, buildSupplier, entityErrorText, validateCategoryName, type SupplierErrors, type SupplierForm } from "../../../lib/inventory";
import { useCursorList } from "../../../lib/use-cursor-list";
import { inventoryBase } from "../../../lib/use-inventory-lookups";
import { Banner, Btn, Card, EmptyState, Field } from "../parts";
import { ListFooter, ListSkeleton } from "./shared";
import ui from "../owner.module.css";

function created(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Categories: a list and an add form. The server offers no rename or delete, so none is shown. */
export function CategoriesView({ salonId }: { salonId: string }) {
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const path = `${inventoryBase(salonId)}/${INVENTORY_PATHS.categories}`;
  const list = useCursorList<InventoryCategoryDto>(path, {});

  async function add() {
    setError(null);
    setNotice(null);
    const problem = validateCategoryName(name);
    setFieldError(problem);
    if (problem) return;
    setSaving(true);
    try {
      await apiFetch<InventoryCategoryDto>(path, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setNotice(`${name.trim()} added.`);
      setName("");
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : "Could not add the category. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={ui.mt16}>
      <Card title="Categories" sub="Groups for your products, such as Hair colour or Skin care.">
        <form onSubmit={(e) => { e.preventDefault(); void add(); }} noValidate>
          <div className={ui.rowWrap}>
            <Field label="New category" htmlFor="cat-name" hint={fieldError}>
              <input id="cat-name" className={ui.input} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(fieldError)} autoComplete="off" />
            </Field>
            <Btn type="submit" variant="primary" disabled={saving}>{saving ? "Adding…" : "Add category"}</Btn>
          </div>
        </form>
        {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
        <div role="status" aria-live="polite">{notice && <div className={ui.mt12}><Banner tone="ok">{notice}</Banner></div>}</div>
        <div className={ui.mt12}>
          {list.loading ? (
            <ListSkeleton />
          ) : list.items.length === 0 && !list.error ? (
            <EmptyState title="No categories yet">Add one above to group your products.</EmptyState>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <caption className={ui.cardSub}>Your categories</caption>
                <thead><tr><th>Name</th><th>Added</th></tr></thead>
                <tbody>
                  {list.items.map((c) => (
                    <tr key={c.id}><td>{c.name}</td><td>{created(c.createdAt)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ListFooter list={list} />
        </div>
      </Card>
    </div>
  );
}

/** Suppliers: a list and an add form. The server offers no edit or delete for suppliers, so none is shown. */
export function SuppliersView({ salonId }: { salonId: string }) {
  const [form, setForm] = useState<SupplierForm>(EMPTY_SUPPLIER);
  const [errors, setErrors] = useState<SupplierErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const path = `${inventoryBase(salonId)}/${INVENTORY_PATHS.suppliers}`;
  const list = useCursorList<InventorySupplierDto>(path, {});
  const set = (patch: Partial<SupplierForm>) => setForm((f) => ({ ...f, ...patch }));

  async function add() {
    setError(null);
    setNotice(null);
    const { body, errors: found } = buildSupplier(form);
    setErrors(found);
    if (!body) return;
    setSaving(true);
    try {
      await apiFetch<InventorySupplierDto>(path, { method: "POST", body: JSON.stringify(body) });
      setNotice(`${body.name} added.`);
      setForm(EMPTY_SUPPLIER);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? entityErrorText(err.code, err.message) : "Could not add the supplier. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={ui.mt16}>
      <Card title="Suppliers" sub="Who you buy from. A supplier can be named on a purchase.">
        <form onSubmit={(e) => { e.preventDefault(); void add(); }} noValidate>
          <div className={ui.rowWrap}>
            <Field label="Name" htmlFor="sup-name" hint={errors.name}>
              <input id="sup-name" className={ui.input} maxLength={120} value={form.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={Boolean(errors.name)} autoComplete="off" />
            </Field>
            <Field label="Contact person (optional)" htmlFor="sup-contact" hint={errors.contactName}>
              <input id="sup-contact" className={ui.input} maxLength={120} value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} autoComplete="off" />
            </Field>
          </div>
          <div className={ui.rowWrap}>
            <Field label="Phone (optional)" htmlFor="sup-phone" hint={errors.phone}>
              <input id="sup-phone" className={ui.input} maxLength={40} value={form.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Email (optional)" htmlFor="sup-email" hint={errors.email}>
              <input id="sup-email" type="email" className={ui.input} maxLength={254} value={form.email} onChange={(e) => set({ email: e.target.value })} aria-invalid={Boolean(errors.email)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="sup-notes" hint={errors.notes}>
            <textarea id="sup-notes" className={ui.input} rows={2} maxLength={500} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Btn type="submit" variant="primary" disabled={saving}>{saving ? "Adding…" : "Add supplier"}</Btn>
          </div>
        </form>
        <p className={ui.cardSub}>Nothing is sent to a supplier from here. This is only a list for your own records.</p>
        {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
        <div role="status" aria-live="polite">{notice && <div className={ui.mt12}><Banner tone="ok">{notice}</Banner></div>}</div>
        <div className={ui.mt12}>
          {list.loading ? (
            <ListSkeleton />
          ) : list.items.length === 0 && !list.error ? (
            <EmptyState title="No suppliers yet">Add one above.</EmptyState>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <caption className={ui.cardSub}>Your suppliers</caption>
                <thead><tr><th>Name</th><th>Contact</th><th>Notes</th><th>Added</th></tr></thead>
                <tbody>
                  {list.items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                      <td className={ui.cardSub}>{s.notes ?? "—"}</td>
                      <td>{created(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ListFooter list={list} />
        </div>
      </Card>
    </div>
  );
}
