"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FINANCE_ATTACHMENT_MIME_TYPES,
  FINANCE_CITY_SUGGESTIONS,
  FINANCE_DEPARTMENTS,
  FINANCE_EXPENSE_STATUS_LABEL,
  FINANCE_EXPENSE_TYPE_LABEL,
  FINANCE_PERSONAL_TREATMENT_LABEL,
  FINANCE_CONTRIBUTOR_TYPE_LABEL,
  FinanceContributorType,
  FinanceErrorCode,
  FinanceExpenseStatus,
  FinanceExpenseType,
  FinancePaymentMethod,
  FinancePersonalTreatment,
  financeExpenseType,
  type FinanceAccountDto,
  type FinanceAuditEventDto,
  type FinanceCategoryDto,
  type FinanceContributorDto,
  type FinanceDuplicateCandidateDto,
  type FinanceExpenseDetailDto,
  type FinanceExpensePageDto,
  type FinanceMeDto,
  type FinanceRef,
} from "@barbercue/shared";
import { apiFetch, apiFetchBlob, ApiError } from "../../../lib/api";
import { Badge, Banner, Btn, Card, Dialog, EmptyState, Field, Skeleton, type BadgeTone } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import css from "./finance.module.css";
import { FIN, errorText, inr, newRequestId, pretty, today } from "./finance-ui";

const STATUS_TONE: Record<FinanceExpenseStatus, BadgeTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "info",
  APPROVED: "warn",
  REJECTED: "bad",
  PARTIALLY_PAID: "warn",
  PAID: "ok",
  CANCELLED: "neutral",
};

export function StatusBadge({ status }: { status: FinanceExpenseStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{FINANCE_EXPENSE_STATUS_LABEL[status]}</Badge>;
}

const EMPTY_FILTERS = { q: "", status: "", type: "", categoryId: "", city: "", department: "", paidByContributorId: "", from: "", to: "" };

export function TypeBadge({ reimbursementRequired }: { reimbursementRequired: boolean }) {
  const type = financeExpenseType({ reimbursementRequired });
  return <Badge tone={type === "REIMBURSEMENT" ? "brand" : "neutral"}>{FINANCE_EXPENSE_TYPE_LABEL[type]}</Badge>;
}

/** Personal-payment treatments that keep an expense a company expense (the person is not paid back). */
const COMPANY_PERSONAL_TREATMENTS = Object.values(FinancePersonalTreatment).filter((t) => t !== FinancePersonalTreatment.REIMBURSABLE);

async function openFile(path: string) {
  const { blob } = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadFile(path: string, fallback: string) {
  const { blob, filename } = await apiFetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? fallback;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function FinanceExpenses({ me }: { me: FinanceMeDto }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FinanceExpensePageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryDto[]>([]);
  const [contributors, setContributors] = useState<FinanceContributorDto[]>([]);
  const [vendors, setVendors] = useState<FinanceRef[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccountDto[]>([]);
  const [editing, setEditing] = useState<FinanceExpenseDetailDto | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<FinanceCategoryDto[]>(`${FIN}/categories`).then(setCategories).catch(() => undefined);
    apiFetch<FinanceRef[]>(`${FIN}/vendors/options`).then(setVendors).catch(() => undefined);
    apiFetch<FinanceContributorDto[]>(`${FIN}/contributors`).then(setContributors).catch(() => undefined);
    if (me.roles.viewCompany) apiFetch<FinanceAccountDto[]>(`${FIN}/accounts`).then(setAccounts).catch(() => undefined);
  }, [me.roles.viewCompany]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ sort, page: String(page), pageSize: "25" });
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    return q.toString();
  }, [filters, sort, page]);

  const load = useCallback(() => {
    apiFetch<FinanceExpensePageDto>(`${FIN}/expenses?${query}`)
      .then((d) => (setData(d), setError(null)))
      .catch((err) => setError(errorText(err, "Could not load expenses.")));
  }, [query]);
  useEffect(load, [load]);

  const setFilter = (k: keyof typeof EMPTY_FILTERS, v: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function exportCsv() {
    try {
      const q = new URLSearchParams(query);
      q.delete("page");
      q.delete("pageSize");
      await downloadFile(`${FIN}/expenses/export?${q}`, "fastque-expenses.csv");
    } catch (err) {
      setError(errorText(err, "Could not export."));
    }
  }

  return (
    <>
      <Card
        title={me.roles.viewCompany ? "Expenses" : "My expenses"}
        sub={data ? `${data.total} expense(s) · ${inr(data.totalAmount)} total for these filters` : undefined}
        action={
          <div className={ui.rowWrap}>
            <Btn small icon="download" onClick={() => void exportCsv()}>Export CSV</Btn>
            <Btn small variant="primary" icon="plus" onClick={() => setEditing("new")}>Add expense</Btn>
          </div>
        }
      >
        <div className={css.filters}>
          <Field label="Search" htmlFor="fx-q">
            <input id="fx-q" type="search" className={ui.input} value={filters.q} placeholder="Description, ID, vendor…" onChange={(e) => setFilter("q", e.target.value)} />
          </Field>
          <Field label="Status" htmlFor="fx-status">
            <select id="fx-status" className={ui.select} value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All statuses</option>
              {Object.values(FinanceExpenseStatus).map((s) => <option key={s} value={s}>{FINANCE_EXPENSE_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Type" htmlFor="fx-type">
            <select id="fx-type" className={ui.select} value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
              <option value="">All types</option>
              {Object.values(FinanceExpenseType).map((t) => <option key={t} value={t}>{FINANCE_EXPENSE_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Category" htmlFor="fx-cat">
            <select id="fx-cat" className={ui.select} value={filters.categoryId} onChange={(e) => setFilter("categoryId", e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Department" htmlFor="fx-dept">
            <select id="fx-dept" className={ui.select} value={filters.department} onChange={(e) => setFilter("department", e.target.value)}>
              <option value="">All</option>
              {FINANCE_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="City" htmlFor="fx-city">
            <input id="fx-city" className={ui.input} value={filters.city} list="fin-cities" placeholder="All" onChange={(e) => setFilter("city", e.target.value)} />
          </Field>
          {me.roles.viewCompany && (
            <Field label="Paid by" htmlFor="fx-paid">
              <select id="fx-paid" className={ui.select} value={filters.paidByContributorId} onChange={(e) => setFilter("paidByContributorId", e.target.value)}>
                <option value="">Anyone</option>
                {contributors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="From" htmlFor="fx-from"><input id="fx-from" type="date" className={ui.input} value={filters.from} onChange={(e) => setFilter("from", e.target.value)} /></Field>
          <Field label="To" htmlFor="fx-to"><input id="fx-to" type="date" className={ui.input} value={filters.to} onChange={(e) => setFilter("to", e.target.value)} /></Field>
          <Field label="Sort" htmlFor="fx-sort">
            <select id="fx-sort" className={ui.select} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amount_desc">Largest amount</option>
              <option value="amount_asc">Smallest amount</option>
            </select>
          </Field>
        </div>
        <datalist id="fin-cities">{FINANCE_CITY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        {Object.values(filters).some(Boolean) && (
          <div className={ui.mt12}><Btn small variant="quiet" onClick={() => (setFilters(EMPTY_FILTERS), setPage(1))}>Clear filters</Btn></div>
        )}
      </Card>

      {error && <Banner tone="error">{error}</Banner>}
      <Card tight>
        {!data ? (
          <Skeleton height={200} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No expenses here yet" action={<Btn small variant="primary" icon="plus" onClick={() => setEditing("new")}>Add expense</Btn>} />
        ) : (
          <>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>Date</th><th>Category</th><th>Type</th><th>Description</th><th className={ui.num}>Amount</th><th>Paid by</th>
                    <th>City</th><th>Department</th><th>Vendor</th><th>Status</th><th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id}>
                      <td className={css.money}>{e.expenseDate}<div className={ui.cardSub}>{e.number}</div></td>
                      <td>{e.category.name}<div className={ui.cardSub}>{e.subcategory?.name ?? e.customSubcategory ?? ""}</div></td>
                      <td><TypeBadge reimbursementRequired={e.reimbursementRequired} /></td>
                      <td>
                        <button type="button" className={css.rowButton} onClick={() => setOpenId(e.id)}>
                          <span className={css.rowTitle}>{e.description}</span>
                        </button>
                        {e.project && <div className={ui.cardSub}>{e.project}</div>}
                      </td>
                      <td className={`${ui.num} ${css.money}`}>{inr(e.amount)}{e.paidAmount !== e.amount && Number(e.paidAmount) > 0 && <div className={ui.cardSub}>paid {inr(e.paidAmount)}</div>}</td>
                      <td>{e.paidBy.length ? e.paidBy.join(", ") : <span className={ui.mutedCell}>Unpaid</span>}</td>
                      <td>{e.city ?? "—"}</td>
                      <td>{e.department ?? "—"}</td>
                      <td>{e.vendor?.name ?? "—"}</td>
                      <td><StatusBadge status={e.status} /></td>
                      <td>{e.attachmentCount ? `${e.attachmentCount} file(s)` : <span className={ui.mutedCell}>None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={css.pager}>
              <span className={ui.hint}>Page {data.page} of {pages}</span>
              <div className={ui.rowWrap}>
                <Btn small disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
                <Btn small disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
              </div>
            </div>
          </>
        )}
      </Card>

      {editing && (
        <ExpenseForm
          me={me}
          categories={categories}
          vendors={vendors}
          contributors={contributors}
          accounts={accounts}
          onContributorAdded={(c) => setContributors((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name)))}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            load();
            setOpenId(id);
          }}
        />
      )}
      {openId && !editing && (
        <ExpenseDrawer
          id={openId}
          me={me}
          accounts={accounts}
          contributors={contributors}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onEdit={(detail) => setEditing(detail)}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ form

/** "Who spent the money?" choice: "unpaid", "me", "person:<id>", "account:<id>" or "new" (add a person). */
type PayerChoice = string;

function ExpenseForm({
  me,
  categories,
  vendors,
  contributors,
  accounts,
  onContributorAdded,
  initial,
  onClose,
  onSaved,
}: {
  me: FinanceMeDto;
  categories: FinanceCategoryDto[];
  vendors: FinanceRef[];
  contributors: FinanceContributorDto[];
  accounts: FinanceAccountDto[];
  onContributorAdded: (c: FinanceContributorDto) => void;
  initial: FinanceExpenseDetailDto | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  // A new expense is a company expense unless the user says it was paid from personal money.
  const [type, setType] = useState<FinanceExpenseType>(initial ? financeExpenseType(initial) : FinanceExpenseType.COMPANY);
  const isClaim = type === FinanceExpenseType.REIMBURSEMENT;
  const [payer, setPayer] = useState<PayerChoice>(initial ? "" : "unpaid");
  const [treatment, setTreatment] = useState<string>(FinancePersonalTreatment.FOUNDER_LOAN);
  const [method, setMethod] = useState<string>(FinancePaymentMethod.UPI);
  const [reference, setReference] = useState("");
  const [newPerson, setNewPerson] = useState({ name: "", type: "FOUNDER" as string });
  const [addingPerson, setAddingPerson] = useState(false);
  const payerIsPerson = payer.startsWith("person:");
  const payerIsAccount = payer.startsWith("account:");
  const chooseType = (next: FinanceExpenseType) => {
    setType(next);
    if (!initial) setPayer(next === FinanceExpenseType.REIMBURSEMENT ? "me" : "unpaid");
  };
  // Editing: the money is locked once approved (finance managers may still reclassify it).
  const locked = !!initial && !initial.can.edit;
  const activePayments = initial?.payments.filter((p) => !p.voided) ?? [];
  const claimPayments = activePayments.filter((p) => p.contributor && p.personalTreatment === FinancePersonalTreatment.REIMBURSABLE);
  const switchingToCompany = !!initial?.reimbursementRequired && !isClaim;
  const switchingToClaim = !!initial && !initial.reimbursementRequired && isClaim;
  const claimBlocked = switchingToClaim && activePayments.length > 0 && claimPayments.length === 0;

  async function addPerson() {
    setAddingPerson(true);
    setError(null);
    try {
      const { id } = await apiFetch<{ id: string }>(`${FIN}/contributors`, { method: "POST", body: JSON.stringify({ name: newPerson.name.trim(), type: newPerson.type }) });
      onContributorAdded({ id, name: newPerson.name.trim(), type: newPerson.type as FinanceContributorDto["type"], userId: null, userEmail: null, email: null, phone: null, notes: null, isActive: true });
      setPayer(`person:${id}`);
      setNewPerson({ name: "", type: "FOUNDER" });
    } catch (err) {
      setError(errorText(err, "Could not add that person."));
    } finally {
      setAddingPerson(false);
    }
  }
  const [form, setForm] = useState({
    expenseDate: initial?.expenseDate ?? today(),
    categoryId: initial?.category.id ?? "",
    subcategoryId: initial?.subcategory?.id ?? "",
    customSubcategory: initial?.customSubcategory ?? "",
    description: initial?.description ?? "",
    amount: initial?.amount ?? "",
    taxAmount: initial?.taxAmount ?? "0",
    vendorId: initial?.vendor?.id ?? "",
    department: initial?.department ?? "",
    city: initial?.city ?? "",
    project: initial?.project ?? "",
    isRecurring: initial?.isRecurring ?? false,
    notes: initial?.notes ?? "",
  });
  const [requestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<FinanceDuplicateCandidateDto[] | null>(null);
  const category = categories.find((c) => c.id === form.categoryId);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(confirmDuplicate = false) {
    setBusy(true);
    setError(null);
    const payload = {
      expenseDate: form.expenseDate,
      categoryId: form.categoryId,
      subcategoryId: form.subcategoryId || undefined,
      customSubcategory: form.subcategoryId ? undefined : form.customSubcategory || undefined,
      description: form.description,
      amount: form.amount,
      taxAmount: form.taxAmount || "0",
      vendorId: form.vendorId || undefined,
      department: form.department || undefined,
      city: form.city || undefined,
      project: form.project || undefined,
      reimbursementRequired: isClaim,
      isRecurring: form.isRecurring,
      notes: form.notes || undefined,
      ...(initial
        ? {}
        : {
            clientRequestId: requestId,
            ...(payer === "me" ? { paidByMe: true } : {}),
            ...(payerIsPerson || payerIsAccount
              ? {
                  paidBy: {
                    payerType: payerIsPerson ? "PERSON" : "COMPANY_ACCOUNT",
                    ...(payerIsPerson
                      ? { contributorId: payer.slice(7), personalTreatment: isClaim ? FinancePersonalTreatment.REIMBURSABLE : treatment }
                      : { accountId: payer.slice(8) }),
                    method,
                    reference: reference.trim() || undefined,
                  },
                }
              : {}),
          }),
      confirmDuplicate,
    };
    try {
      const res = await apiFetch<{ id: string }>(initial ? `${FIN}/expenses/${initial.id}` : `${FIN}/expenses`, {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      onSaved(res.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === FinanceErrorCode.DUPLICATE_SUSPECTED) {
        setDuplicates(((err.details as { candidates?: FinanceDuplicateCandidateDto[] })?.candidates) ?? []);
      } else setError(errorText(err, "Could not save the expense."));
    } finally {
      setBusy(false);
    }
  }

  const payerChosen = !!initial || (isClaim ? payer === "me" || payerIsPerson : payer === "unpaid" || payerIsPerson || payerIsAccount);
  const valid = form.expenseDate && form.categoryId && form.description.trim().length >= 3 && Number(form.amount) > 0 && payerChosen && !claimBlocked;
  const otherPeople = me.roles.manage ? contributors.filter((c) => c.isActive && c.id !== me.contributorId) : [];
  const activeAccounts = me.roles.manage ? accounts.filter((a) => a.isActive) : [];
  const typeHint = claimBlocked
    ? "This expense was paid by the company (or is not to be paid back), so it cannot be a reimbursement claim. Void that payment in the expense details first."
    : switchingToCompany && claimPayments.length
      ? `The personal payment by ${claimPayments.map((p) => p.contributor!.name).join(", ")} will be voided and any open claim cancelled. Record the company payment afterwards.`
      : switchingToClaim && claimPayments.length && initial?.status !== "DRAFT"
        ? "A reimbursement claim is opened for the personal payment."
        : isClaim
          ? "Money someone paid from their own pocket for FastQue and wants back. It appears under Reimbursements."
          : "FastQue's own spend — paid from a company account or card, or a bill to pay. It is tracked by category, not as a reimbursement.";
  return (
    <Dialog title={initial ? (locked ? `Reclassify ${initial.number}` : `Edit ${initial.number}`) : "Add expense"} onClose={onClose} wide>
      <form onSubmit={(e) => (e.preventDefault(), void save())} noValidate>
        {error && <Banner tone="error">{error}</Banner>}
        {duplicates && (
          <Banner tone="warn">
            This looks like an expense already recorded:
            <ul>{duplicates.map((d) => <li key={d.id}>{d.number} · {d.expenseDate} · {inr(d.amount)} · {d.description} ({FINANCE_EXPENSE_STATUS_LABEL[d.status]})</li>)}</ul>
            <Btn small variant="primary" disabled={busy} onClick={() => void save(true)}>It is different — save anyway</Btn>
          </Banner>
        )}
        <div className={ui.formGrid}>
          <Field label="Expense date *" htmlFor="ef-date"><input id="ef-date" type="date" className={ui.input} value={form.expenseDate} max={today()} disabled={locked} onChange={(e) => set("expenseDate", e.target.value)} required /></Field>
          <Field label="Amount (₹, incl. tax) *" htmlFor="ef-amount"><input id="ef-amount" inputMode="decimal" className={ui.input} value={form.amount} disabled={locked} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" required /></Field>
          <Field label="Main category *" htmlFor="ef-cat">
            <select id="ef-cat" className={ui.select} value={form.categoryId} onChange={(e) => (set("categoryId", e.target.value), set("subcategoryId", ""), set("department", form.department || categories.find((c) => c.id === e.target.value)?.department || ""))} required>
              <option value="">Choose…</option>
              {categories.filter((c) => c.isActive || c.id === form.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subcategory" htmlFor="ef-sub">
            <select id="ef-sub" className={ui.select} value={form.subcategoryId} onChange={(e) => set("subcategoryId", e.target.value)} disabled={!category}>
              <option value="">{category ? "Other (type below)" : "Choose a category first"}</option>
              {category?.subcategories.filter((s) => s.isActive || s.id === form.subcategoryId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {!form.subcategoryId && (
            <Field label="Custom subcategory" htmlFor="ef-custom"><input id="ef-custom" className={ui.input} value={form.customSubcategory} maxLength={80} onChange={(e) => set("customSubcategory", e.target.value)} /></Field>
          )}
          <Field label="GST / tax included (₹)" htmlFor="ef-tax"><input id="ef-tax" inputMode="decimal" className={ui.input} value={form.taxAmount} disabled={locked} onChange={(e) => set("taxAmount", e.target.value)} /></Field>
          <div className={css.formWide}>
            <Field label="Exact description *" htmlFor="ef-desc"><textarea id="ef-desc" className={ui.textarea} value={form.description} maxLength={1000} rows={2} disabled={locked} onChange={(e) => set("description", e.target.value)} required /></Field>
          </div>
          <Field label="Vendor / payee" htmlFor="ef-vendor">
            <select id="ef-vendor" className={ui.select} value={form.vendorId} disabled={locked} onChange={(e) => set("vendorId", e.target.value)}>
              <option value="">None</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Department" htmlFor="ef-dept">
            <select id="ef-dept" className={ui.select} value={form.department} onChange={(e) => set("department", e.target.value)}>
              <option value="">Not assigned</option>
              {FINANCE_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="City / territory" htmlFor="ef-city"><input id="ef-city" className={ui.input} list="fin-cities" value={form.city} maxLength={60} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="Project or campaign" htmlFor="ef-project"><input id="ef-project" className={ui.input} value={form.project} maxLength={120} onChange={(e) => set("project", e.target.value)} /></Field>
          <div className={css.formWide}>
            <Field label="Notes" htmlFor="ef-notes"><textarea id="ef-notes" className={ui.textarea} value={form.notes} maxLength={1000} rows={2} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
        </div>
        <datalist id="fin-cities">{FINANCE_CITY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        <div className={`${ui.formGrid} ${ui.mt12}`}>
          <div className={css.formWide}>
            <Field label="Expense type *" htmlFor="ef-type" hint={typeHint}>
              <select id="ef-type" className={ui.select} value={type} onChange={(e) => chooseType(e.target.value as FinanceExpenseType)}>
                <option value={FinanceExpenseType.COMPANY}>Company expense — paid or to be paid by FastQue</option>
                <option value={FinanceExpenseType.REIMBURSEMENT}>Reimbursement claim — paid from personal money, to be paid back</option>
              </select>
            </Field>
          </div>
          {initial ? (
            <div className={css.formWide}>
              <Field label="Who spent the money" htmlFor="ef-payer-ro" hint="To change who paid, void or add a payment in the expense details — the history is kept.">
                <input id="ef-payer-ro" className={ui.input} value={initial.paidBy.length ? initial.paidBy.join(", ") : "Not paid yet"} readOnly />
              </Field>
            </div>
          ) : (
            <>
              <Field
                label={isClaim ? "Who paid from their own money? *" : "Payment source *"}
                htmlFor="ef-payer"
                hint={payer === "unpaid" ? (me.roles.manage ? "Record the company payment later from the expense details." : "Finance records the company payment.") : undefined}
              >
                <select id="ef-payer" className={ui.select} value={payer} onChange={(e) => setPayer(e.target.value)} required>
                  {isClaim ? (
                    <>
                      <option value="me">I paid it myself — reimburse me{me.contributorId ? "" : " (your finance record is created automatically)"}</option>
                      {otherPeople.length > 0 && (
                        <optgroup label="Someone else paid — reimburse them">
                          {otherPeople.map((c) => <option key={c.id} value={`person:${c.id}`}>{c.name} ({FINANCE_CONTRIBUTOR_TYPE_LABEL[c.type]})</option>)}
                        </optgroup>
                      )}
                    </>
                  ) : (
                    <>
                      <option value="unpaid">{me.roles.manage ? "Not paid yet (a bill to pay later)" : "Paid or to be paid by FastQue (company account, card or bill)"}</option>
                      {activeAccounts.length > 0 && (
                        <optgroup label="Paid from a FastQue company account">
                          {activeAccounts.map((a) => <option key={a.id} value={`account:${a.id}`}>Company · {a.name}</option>)}
                        </optgroup>
                      )}
                      {otherPeople.length > 0 && (
                        <optgroup label="A person paid, not to be paid back">
                          {otherPeople.map((c) => <option key={c.id} value={`person:${c.id}`}>{c.name} ({FINANCE_CONTRIBUTOR_TYPE_LABEL[c.type]})</option>)}
                        </optgroup>
                      )}
                    </>
                  )}
                  {me.roles.manage && <option value="new">+ Add a new person…</option>}
                </select>
              </Field>
              {payer === "new" && (
                <>
                  <Field label="New person's name *" htmlFor="ef-new-name"><input id="ef-new-name" className={ui.input} value={newPerson.name} maxLength={120} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} /></Field>
                  <Field label="Type" htmlFor="ef-new-type">
                    <select id="ef-new-type" className={ui.select} value={newPerson.type} onChange={(e) => setNewPerson({ ...newPerson, type: e.target.value })}>
                      {Object.values(FinanceContributorType).map((t) => <option key={t} value={t}>{FINANCE_CONTRIBUTOR_TYPE_LABEL[t]}</option>)}
                    </select>
                  </Field>
                  <div className={css.formWide}><Btn small variant="primary" disabled={addingPerson || newPerson.name.trim().length < 2} onClick={() => void addPerson()}>{addingPerson ? "Adding…" : "Add person"}</Btn></div>
                </>
              )}
              {payerIsPerson && !isClaim && (
                <Field label="Treat this personal payment as" htmlFor="ef-treat" hint="Agreed with the person. It is never counted as company cash received. To pay them back, choose “Reimbursement claim” above.">
                  <select id="ef-treat" className={ui.select} value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                    {COMPANY_PERSONAL_TREATMENTS.map((t) => <option key={t} value={t}>{FINANCE_PERSONAL_TREATMENT_LABEL[t]}</option>)}
                  </select>
                </Field>
              )}
              {(payerIsPerson || payerIsAccount) && (
                <>
                  <Field label="Payment method" htmlFor="ef-method">
                    <select id="ef-method" className={ui.select} value={method} onChange={(e) => setMethod(e.target.value)}>
                      {Object.values(FinancePaymentMethod).map((m) => <option key={m} value={m}>{pretty(m)}</option>)}
                    </select>
                  </Field>
                  <Field label="Payment reference (UTR / txn ID)" htmlFor="ef-ref"><input id="ef-ref" className={ui.input} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></Field>
                </>
              )}
            </>
          )}
        </div>
        <label className={`${ui.checkRow} ${ui.mt12}`}>
          <input type="checkbox" checked={form.isRecurring} onChange={(e) => set("isRecurring", e.target.checked)} />
          <span>Recurring expense (hosting, subscriptions, salaries…)</span>
        </label>
        {locked && <p className={ui.hint}>This expense is already approved: its amount, date, description and vendor are locked. You can still correct its category, department, city, project, notes and type.</p>}
        <p className={ui.hint}>Saved as a draft with who paid. Add receipts and submit it for approval from the expense details. Approval does not mark it paid — only recorded payments do.</p>
        <div className={ui.dialogActions}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn type="submit" variant="primary" disabled={busy || !valid}>{busy ? "Saving…" : initial ? "Save changes" : "Save draft"}</Btn>
        </div>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ detail drawer

function ExpenseDrawer({
  id,
  me,
  accounts,
  contributors,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string;
  me: FinanceMeDto;
  accounts: FinanceAccountDto[];
  contributors: FinanceContributorDto[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: (detail: FinanceExpenseDetailDto) => void;
}) {
  const [e, setE] = useState<FinanceExpenseDetailDto | null>(null);
  const [audit, setAudit] = useState<FinanceAuditEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<FinanceExpenseDetailDto>(`${FIN}/expenses/${id}`).then(setE).catch((err) => setError(errorText(err, "Could not load the expense.")));
    apiFetch<FinanceAuditEventDto[]>(`${FIN}/expenses/${id}/audit`).then(setAudit).catch(() => undefined);
  }, [id]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(done);
      load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body?: unknown) => apiFetch(`${FIN}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });

  async function upload(file: File, confirm = false) {
    const body = new FormData();
    body.append("file", file);
    try {
      await apiFetch(`${FIN}/expenses/${id}/attachments${confirm ? "?confirmDuplicate=1" : ""}`, { method: "POST", body });
      setNotice("Receipt uploaded.");
      load();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === FinanceErrorCode.DUPLICATE_ATTACHMENT && (err.details as { expenseNumber?: string })?.expenseNumber) {
        if (window.confirm(`${err.message}\n\nAttach it here as well?`)) return upload(file, true);
      } else setError(errorText(err, "Could not upload the receipt."));
    }
  }

  const ask = (q: string) => {
    const v = window.prompt(q);
    return v && v.trim().length >= 3 ? v.trim() : null;
  };

  return (
    <Dialog title={e ? `${e.number} · ${inr(e.amount)}` : "Expense"} onClose={onClose} drawer>
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      {!e ? (
        <Skeleton height={300} />
      ) : (
        <div className={ui.stackSm}>
          <div className={ui.rowWrap}><StatusBadge status={e.status} />{e.isRecurring && <Badge tone="info">Recurring</Badge>}<TypeBadge reimbursementRequired={e.reimbursementRequired} /></div>
          <p>{e.description}</p>
          <dl className={ui.kv}>
            <dt>Expense date</dt><dd>{e.expenseDate}</dd>
            <dt>Type</dt><dd>{FINANCE_EXPENSE_TYPE_LABEL[financeExpenseType(e)]}</dd>
            <dt>Category</dt><dd>{e.category.name}{e.subcategory || e.customSubcategory ? ` › ${e.subcategory?.name ?? e.customSubcategory}` : ""}</dd>
            <dt>Amount</dt><dd>{inr(e.amount)} (tax {inr(e.taxAmount)})</dd>
            <dt>Paid so far</dt><dd>{inr(e.paidAmount)}</dd>
            <dt>Vendor</dt><dd>{e.vendor?.name ?? "—"}</dd>
            <dt>Department · City</dt><dd>{e.department ?? "—"} · {e.city ?? "—"}</dd>
            <dt>Project</dt><dd>{e.project ?? "—"}</dd>
            <dt>Entered by</dt><dd>{e.createdBy?.name ?? "—"}</dd>
            <dt>Approved by</dt><dd>{e.approvedBy ? `${e.approvedBy.name} · ${new Date(e.approvedAt!).toLocaleString("en-IN")}` : "—"}</dd>
            {e.reviewNote && (<><dt>Review note</dt><dd>{e.reviewNote}</dd></>)}
            {e.notes && (<><dt>Notes</dt><dd>{e.notes}</dd></>)}
          </dl>

          <div className={ui.rowWrap}>
            {e.can.edit && <Btn small onClick={() => onEdit(e)}>Edit</Btn>}
            {!e.can.edit && e.can.reclassify && <Btn small onClick={() => onEdit(e)}>Change category or type</Btn>}
            {e.can.submit && <Btn small variant="primary" disabled={busy} onClick={() => void act(() => post(`expenses/${id}/submit`), "Submitted for approval.")}>Submit for approval</Btn>}
            {e.can.review && e.status === "SUBMITTED" && <Btn small disabled={busy} onClick={() => void act(() => post(`expenses/${id}/review`, { action: "START_REVIEW" }), "Marked under review.")}>Start review</Btn>}
            {e.can.review && <Btn small variant="primary" disabled={busy} onClick={() => void act(() => post(`expenses/${id}/review`, { action: "APPROVE" }), "Approved. It stays unpaid until a payment is recorded.")}>Approve</Btn>}
            {e.can.review && (
              <Btn small variant="danger" disabled={busy} onClick={() => { const note = ask("Why is it rejected?"); if (note) void act(() => post(`expenses/${id}/review`, { action: "REJECT", note }), "Rejected."); }}>Reject</Btn>
            )}
            {e.can.cancel && (
              <Btn small variant="quiet" disabled={busy} onClick={() => { const reason = ask("Why cancel this expense?"); if (reason) void act(() => post(`expenses/${id}/cancel`, { reason }), "Cancelled."); }}>Cancel expense</Btn>
            )}
            {e.can.delete && (
              <Btn small variant="quiet" disabled={busy} onClick={() => { if (window.confirm("Delete this draft permanently?")) void act(async () => { await apiFetch(`${FIN}/expenses/${id}`, { method: "DELETE" }); onClose(); }, "Draft deleted."); }}>Delete draft</Btn>
            )}
          </div>

          <Card title="Payments" sub="Who paid and how. A split between several payers never duplicates the expense." tight action={e.can.pay && !paying ? <Btn small icon="plus" onClick={() => setPaying(true)}>Record payment</Btn> : undefined}>
            {paying && (
              <PaymentForm
                expense={e}
                accounts={accounts}
                contributors={contributors}
                onCancel={() => setPaying(false)}
                onSaved={() => (setPaying(false), setNotice("Payment recorded."), load(), onChanged())}
              />
            )}
            {e.payments.length === 0 ? (
              <p className={ui.hint}>No payments recorded.</p>
            ) : (
              <ul className={css.timeline}>
                {e.payments.map((p) => (
                  <li key={p.id} style={p.voided ? { opacity: 0.55 } : undefined}>
                    <strong>{inr(p.amount)}</strong> on {p.paidOn} · {p.contributor ? `${p.contributor.name} (personal — ${FINANCE_PERSONAL_TREATMENT_LABEL[p.personalTreatment!]})` : `Company · ${p.account?.name}`} · {pretty(p.method)}
                    {p.reference && ` · ref ${p.reference}`}
                    {p.voided && <div className={css.changes}>Voided: {p.voidReason}</div>}
                    {!p.voided && me.roles.manage && (
                      <div><Btn small variant="quiet" disabled={busy} onClick={() => { const reason = ask("Why void this payment? (It stays in the history.)"); if (reason) void act(() => post(`payments/${p.id}/void`, { reason }), "Payment voided."); }}>Void</Btn></div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Receipts" tight sub="JPG, PNG, WebP or PDF, up to 5 MB. Stored privately.">
            {e.attachments.length === 0 && <p className={ui.hint}>No receipts attached.</p>}
            <ul className={css.timeline}>
              {e.attachments.map((a) => (
                <li key={a.id}>
                  {a.fileName} · {Math.ceil(a.sizeBytes / 1024)} KB
                  <div className={ui.rowWrap}>
                    <Btn small variant="quiet" onClick={() => void openFile(`${FIN}/attachments/${a.id}`).catch((err) => setError(errorText(err)))}>Preview</Btn>
                    <Btn small variant="quiet" onClick={() => void downloadFile(`${FIN}/attachments/${a.id}`, a.fileName).catch((err) => setError(errorText(err)))}>Download</Btn>
                    {e.can.edit && <Btn small variant="quiet" onClick={() => void act(() => apiFetch(`${FIN}/attachments/${a.id}`, { method: "DELETE" }), "Receipt removed.")}>Remove</Btn>}
                  </div>
                </li>
              ))}
            </ul>
            {e.status !== "CANCELLED" && (me.roles.manage || e.createdBy?.id) && (
              <input
                type="file"
                accept={FINANCE_ATTACHMENT_MIME_TYPES.join(",")}
                multiple
                aria-label="Upload receipts"
                className={ui.mt12}
                onChange={(ev) => {
                  const files = Array.from(ev.target.files ?? []);
                  ev.target.value = "";
                  void files.reduce((p, f) => p.then(() => upload(f)), Promise.resolve());
                }}
              />
            )}
          </Card>

          <Card title="History" tight sub="Every change, approval and payment — this record cannot be edited.">
            {!audit ? <Skeleton height={60} /> : audit.length === 0 ? <p className={ui.hint}>No history.</p> : (
              <ul className={css.timeline}>
                {audit.map((a) => (
                  <li key={a.id}>
                    <strong>{a.action}</strong> · {a.actor ?? "system"} · {new Date(a.createdAt).toLocaleString("en-IN")}
                    {a.note && <div className={css.changes}>{a.note}</div>}
                    {a.changes && (
                      <div className={css.changes}>
                        {Object.entries(a.changes).map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`).join(" · ")}
                      </div>
                    )}
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

function PaymentForm({
  expense,
  accounts,
  contributors,
  onCancel,
  onSaved,
}: {
  expense: FinanceExpenseDetailDto;
  accounts: FinanceAccountDto[];
  contributors: FinanceContributorDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const remaining = (Number(expense.amount) - Number(expense.paidAmount)).toFixed(2);
  const [f, setF] = useState({
    amount: remaining,
    paidOn: today(),
    payerType: accounts.length ? "COMPANY_ACCOUNT" : "PERSON",
    accountId: accounts.find((a) => a.isActive)?.id ?? "",
    contributorId: "",
    // A personal payment on a reimbursement claim is to be paid back; on a company expense the
    // treatment must be chosen (choosing "to be reimbursed" turns the expense into a claim).
    personalTreatment: expense.reimbursementRequired ? "REIMBURSABLE" : "",
    method: "UPI",
    reference: "",
  });
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${FIN}/expenses/${expense.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: f.amount,
          paidOn: f.paidOn,
          payerType: f.payerType,
          ...(f.payerType === "COMPANY_ACCOUNT" ? { accountId: f.accountId } : { contributorId: f.contributorId, personalTreatment: f.personalTreatment }),
          method: f.method,
          reference: f.reference || undefined,
          clientRequestId: requestId,
        }),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Could not record the payment."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={ui.stackSm}>
      {error && <Banner tone="error">{error}</Banner>}
      <div className={ui.formGrid}>
        <Field label={`Amount (₹) — ${inr(remaining)} left`} htmlFor="pf-amount"><input id="pf-amount" inputMode="decimal" className={ui.input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Payment date" htmlFor="pf-date"><input id="pf-date" type="date" className={ui.input} value={f.paidOn} max={today()} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label="Paid from" htmlFor="pf-type">
          <select id="pf-type" className={ui.select} value={f.payerType} onChange={(e) => setF({ ...f, payerType: e.target.value })}>
            <option value="COMPANY_ACCOUNT">A FastQue company account</option>
            <option value="PERSON">A person&apos;s own money</option>
          </select>
        </Field>
        {f.payerType === "COMPANY_ACCOUNT" ? (
          <Field label="Company account" htmlFor="pf-acc" hint={accounts.length ? undefined : "Add a company account in Settings first."}>
            <select id="pf-acc" className={ui.select} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
              <option value="">Choose…</option>
              {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Who paid" htmlFor="pf-who">
              <select id="pf-who" className={ui.select} value={f.contributorId} onChange={(e) => setF({ ...f, contributorId: e.target.value })}>
                <option value="">Choose…</option>
                {contributors.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Treated as" htmlFor="pf-treat" hint="Agreed with the person. It is never recorded as company cash received. “To be reimbursed” makes this expense a reimbursement claim.">
              <select id="pf-treat" className={ui.select} value={f.personalTreatment} onChange={(e) => setF({ ...f, personalTreatment: e.target.value })}>
                <option value="">Choose…</option>
                {Object.values(FinancePersonalTreatment).map((t) => <option key={t} value={t}>{FINANCE_PERSONAL_TREATMENT_LABEL[t]}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Method" htmlFor="pf-method">
          <select id="pf-method" className={ui.select} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {Object.values(FinancePaymentMethod).map((m) => <option key={m} value={m}>{pretty(m)}</option>)}
          </select>
        </Field>
        <Field label="Reference (UTR / txn ID)" htmlFor="pf-ref"><input id="pf-ref" className={ui.input} value={f.reference} maxLength={120} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <div className={ui.rowWrap}>
        <Btn small onClick={onCancel}>Cancel</Btn>
        <Btn small variant="primary" disabled={busy || !(Number(f.amount) > 0) || (f.payerType === "COMPANY_ACCOUNT" ? !f.accountId : !f.contributorId || !f.personalTreatment)} onClick={() => void save()}>{busy ? "Saving…" : "Record payment"}</Btn>
      </div>
    </div>
  );
}
