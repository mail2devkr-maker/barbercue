"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  CRM_BUSINESS_TYPE_LABEL,
  CRM_BUSINESS_TYPES,
  CRM_LEAD_STATUS_META,
  CRM_LEAD_STATUSES,
  CRM_MANUAL_LEAD_STATUSES,
  CRM_WORKFLOW_LOCKED_STATUSES,
  CrmLeadPriority,
  CrmLeadSource,
  type CrmActivityDto,
  type CrmEmployeeRefDto,
  type CrmImportPreviewDto,
  type CrmLeadDto,
  type CrmLeadStatus,
  type CrmPageDto,
} from "@barbercue/shared";
import { apiFetch, apiFetchBlob } from "../../lib/api";
import { dayOnly, errorText, fromLocalInput, jsonBody, pretty, queryParam, toLocalInput, useCrmData, useQueryFlag, when } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { CallLogDialog, MeetingDialog, ScheduleCallDialog, TaskDialog } from "./CrmForms";
import { clean, Dialog, Drawer, Empty, Field, Pager, Pill } from "./ui";
import s from "./crm.module.css";

const GROUP_TONE = { OPEN: "brand", WORKING: "warn", PIPELINE: "brand", WON: "ok", CLOSED: "bad" } as const;
export function LeadStatus({ status }: { status: CrmLeadStatus }) {
  const meta = CRM_LEAD_STATUS_META[status];
  return <Pill tone={GROUP_TONE[meta.group]}>{meta.label}</Pill>;
}

/** Leads: search/filter, create, detail drawer with timeline; managers also import and assign. */
export function CrmLeads() {
  const me = useMe();
  const [filters, setFilters] = useState({ q: "", status: "", priority: "", employeeId: "", followUpDue: "", sort: "updated" });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q })), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams({ page: String(page), limit: "25", sort: filters.sort });
  for (const k of ["q", "status", "priority", "employeeId", "followUpDue"] as const) if (filters[k]) params.set(k, filters[k]);
  const { data, error, reload, setData } = useCrmData<CrmPageDto<CrmLeadDto>>(`crm/leads?${params}`);
  const team = useCrmData<CrmEmployeeRefDto[]>(me?.can.viewTeam ? "crm/employees" : null).data;
  const [creating, setCreating] = useQueryFlag("new");
  const [importing, setImporting] = useQueryFlag("import");
  const [openId, setOpenId] = useState<string | null>(() => queryParam("lead"));
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkTo, setBulkTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const setF = (k: keyof typeof filters) => (e: { target: { value: string } }) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };
  async function bulkAssign() {
    if (!bulkTo || selected.length === 0) return;
    try {
      const r = await apiFetch<{ assigned: number; skipped: Array<{ id: string; reason: string }> }>("crm/leads/bulk-assign", { method: "POST", ...jsonBody({ leadIds: selected, employeeId: bulkTo }) });
      setMsg(`Assigned ${r.assigned} lead(s).${r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped[0].reason}` : ""}`);
      setSelected([]);
      reload();
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }

  return (
    <>
      <div className={s.toolbar}>
        <input className={`${s.input} ${s.search}`} placeholder="Search salon, owner, phone, area" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
        <select className={s.select} value={filters.status} onChange={setF("status")} aria-label="Status">
          <option value="">All statuses</option>
          {CRM_LEAD_STATUSES.map((st) => <option key={st} value={st}>{CRM_LEAD_STATUS_META[st].label}</option>)}
        </select>
        <select className={s.select} value={filters.priority} onChange={setF("priority")} aria-label="Priority">
          <option value="">Any priority</option>
          {Object.keys(CrmLeadPriority).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
        </select>
        <select className={s.select} value={filters.followUpDue} onChange={setF("followUpDue")} aria-label="Follow-up">
          <option value="">Any follow-up</option>
          <option value="true">Follow-up due</option>
        </select>
        {team && (
          <select className={s.select} value={filters.employeeId} onChange={setF("employeeId")} aria-label="Employee">
            <option value="">All employees</option>
            {team.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </select>
        )}
        <select className={s.select} value={filters.sort} onChange={setF("sort")} aria-label="Sort">
          <option value="updated">Recently updated</option>
          <option value="created">Newest</option>
          <option value="followUp">Next follow-up</option>
          <option value="priority">Priority</option>
          <option value="name">Name</option>
        </select>
        {me?.role !== "VIEWER" && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setCreating(true)}>+ Add lead</button>}
        {me?.can.importLeads && <button type="button" className={s.btn} onClick={() => setImporting(true)}>Import</button>}
      </div>
      {me?.can.assignLeads && selected.length > 0 && (
        <div className={`${s.alert} ${s.alertInfo}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{selected.length} selected</strong>
          <select className={s.select} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} aria-label="Assign selected to">
            <option value="">Assign to…</option>
            {team?.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </select>
          <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} disabled={!bulkTo} onClick={() => void bulkAssign()}>Assign</button>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setSelected([])}>Clear</button>
        </div>
      )}
      {msg && <p className={`${s.alert} ${s.alertInfo}`} role="status">{msg}</p>}
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      {!data ? <div className={s.skel} /> : data.items.length === 0 ? <Empty>No leads match. Add one or clear the filters.</Empty> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {me?.can.assignLeads && <th aria-label="Select"><input type="checkbox" checked={selected.length === data.items.length} onChange={(e) => setSelected(e.target.checked ? data.items.map((l) => l.id) : [])} /></th>}
                <th>Salon</th><th>Contact</th><th>Area</th><th>Status</th><th>Priority</th><th>Next follow-up</th>{team && <th>Owner</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <tr key={l.id} onClick={() => setOpenId(l.id)} style={{ cursor: "pointer" }}>
                  {me?.can.assignLeads && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${l.shopName}`} checked={selected.includes(l.id)} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id)))} />
                    </td>
                  )}
                  <td><strong>{l.shopName}</strong><div className={s.faint}>{l.businessType ? CRM_BUSINESS_TYPE_LABEL[l.businessType as keyof typeof CRM_BUSINESS_TYPE_LABEL] ?? l.businessType : pretty(l.source)}</div></td>
                  <td>{l.ownerName ?? l.contactName ?? "—"}<div className={s.faint}>{l.phone ?? ""}</div></td>
                  <td>{[l.locality, l.city].filter(Boolean).join(", ") || "—"}</td>
                  <td><LeadStatus status={l.status} /></td>
                  <td>{pretty(l.priority)}</td>
                  <td>{l.nextFollowUpAt ? when(l.nextFollowUpAt) : "—"}</td>
                  {team && <td>{l.assignedEmployee.fullName}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      {creating && (
        <LeadFormDialog
          onClose={() => setCreating(false)}
          onSaved={(l) => {
            setCreating(false);
            setOpenId(l.id);
            reload();
          }}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => reload()} />}
      {openId && (
        <LeadDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={(l) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === l.id ? l : x)) } : d))}
        />
      )}
    </>
  );
}

// ---------- Create / edit ----------

type LeadForm = Record<string, string>;
const FIELDS: Array<[string, string, ("text" | "tel" | "email" | "number" | "url")?]> = [
  ["shopName", "Salon name *"],
  ["ownerName", "Owner name"],
  ["managerName", "Manager name"],
  ["phone", "Phone", "tel"],
  ["whatsappPhone", "WhatsApp", "tel"],
  ["alternatePhone", "Alternate phone", "tel"],
  ["email", "Email", "email"],
  ["addressLine", "Address"],
  ["locality", "Area / locality"],
  ["city", "City"],
  ["state", "State"],
  ["postalCode", "PIN code"],
  ["mapsUrl", "Google Maps link", "url"],
  ["chairCount", "Chairs", "number"],
  ["salonSize", "Salon size"],
  ["existingSoftware", "Current software"],
  ["territory", "Territory"],
  ["nextAction", "Next action"],
];

function LeadFormDialog({ lead, onClose, onSaved }: { lead?: CrmLeadDto; onClose: () => void; onSaved: (l: CrmLeadDto) => void }) {
  const me = useMe();
  const team = useCrmData<CrmEmployeeRefDto[]>(!lead && me?.can.viewTeam ? "crm/employees" : null).data;
  const init: LeadForm = {};
  for (const [k] of FIELDS) init[k] = lead ? String((lead as unknown as Record<string, unknown>)[k] ?? "") : "";
  Object.assign(init, {
    businessType: lead?.businessType ?? "",
    source: lead?.source ?? "FIELD_VISIT",
    priority: lead?.priority ?? "NORMAL",
    interestLevel: lead?.interestLevel ? String(lead.interestLevel) : "",
    nextFollowUpAt: toLocalInput(lead?.nextFollowUpAt),
    notes: lead?.notes ?? "",
    objections: lead?.objections ?? "",
    assignToEmployeeId: "",
  });
  const [form, setForm] = useState<LeadForm>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = clean(
        {
          ...form,
          chairCount: form.chairCount ? Number(form.chairCount) : "",
          interestLevel: form.interestLevel ? Number(form.interestLevel) : "",
          nextFollowUpAt: fromLocalInput(form.nextFollowUpAt) ?? "",
        },
        !!lead,
      );
      if (lead) {
        delete body.assignToEmployeeId;
        body.shopName = form.shopName;
        body.source = form.source;
        body.priority = form.priority;
      }
      onSaved(await apiFetch<CrmLeadDto>(lead ? `crm/leads/${lead.id}` : "crm/leads", { method: lead ? "PATCH" : "POST", ...jsonBody(body) }));
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={lead ? `Edit ${lead.shopName}` : "Add lead"} onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <div className={s.formGrid}>
          {FIELDS.map(([k, label, type]) => (
            <Field key={k} label={label}>
              <input className={s.input} type={type ?? "text"} required={k === "shopName"} value={form[k]} onChange={set(k)} inputMode={type === "tel" ? "tel" : undefined} />
            </Field>
          ))}
          <Field label="Business type">
            <select className={s.select} value={form.businessType} onChange={set("businessType")}>
              <option value="">—</option>
              {CRM_BUSINESS_TYPES.map((t) => <option key={t} value={t}>{CRM_BUSINESS_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select className={s.select} value={form.source} onChange={set("source")}>
              {Object.keys(CrmLeadSource).map((v) => <option key={v} value={v}>{pretty(v)}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={s.select} value={form.priority} onChange={set("priority")}>
              {Object.keys(CrmLeadPriority).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
            </select>
          </Field>
          <Field label="Interest (1–5)">
            <select className={s.select} value={form.interestLevel} onChange={set("interestLevel")}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Next follow-up"><input type="datetime-local" className={s.input} value={form.nextFollowUpAt} onChange={set("nextFollowUpAt")} /></Field>
          {team && (
            <Field label="Assign to">
              <select className={s.select} value={form.assignToEmployeeId} onChange={set("assignToEmployeeId")}>
                <option value="">— Choose —</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Objections"><textarea className={s.textarea} maxLength={1000} value={form.objections} onChange={set("objections")} /></Field>
        <Field label="Notes"><textarea className={s.textarea} maxLength={2000} value={form.notes} onChange={set("notes")} /></Field>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Save lead"}</button>
      </form>
    </Dialog>
  );
}

// ---------- Detail drawer ----------

function LeadDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (l: CrmLeadDto) => void }) {
  const me = useMe();
  const router = useRouter();
  const { data: lead, error, setData } = useCrmData<CrmLeadDto>(`crm/leads/${id}`);
  const timeline = useCrmData<CrmActivityDto[]>(`crm/leads/${id}/timeline`);
  const team = useCrmData<CrmEmployeeRefDto[]>(me?.can.assignLeads ? "crm/employees" : null).data;
  const [dialog, setDialog] = useState<null | "edit" | "call" | "scheduleCall" | "meeting" | "task">(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const canWrite = me?.role !== "VIEWER";
  const statusLocked = me?.role === "FIELD_EMPLOYEE" && !!lead && CRM_WORKFLOW_LOCKED_STATUSES.includes(lead.status);

  function changed(l: CrmLeadDto) {
    setData(l);
    onChanged(l);
    timeline.reload();
  }
  async function patch(body: Record<string, unknown>) {
    try {
      changed(await apiFetch<CrmLeadDto>(`crm/leads/${id}`, { method: "PATCH", ...jsonBody(body) }));
      setMsg(null);
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }
  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      timeline.setData(await apiFetch<CrmActivityDto[]>(`crm/leads/${id}/notes`, { method: "POST", ...jsonBody({ body: note.trim() }) }));
      setNote("");
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }
  async function assign(employeeId: string) {
    try {
      await apiFetch(`crm/leads/${id}/assign`, { method: "POST", ...jsonBody({ employeeId }) });
      changed(await apiFetch<CrmLeadDto>(`crm/leads/${id}`));
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }
  async function startOnboarding() {
    if (!lead) return;
    if (lead.onboarding) return router.push(`/employee/onboarding/${lead.onboarding.id}`);
    try {
      const app = await apiFetch<{ id: string }>(`employee/leads/${id}/onboarding`, { method: "POST", ...jsonBody({}) });
      router.push(`/employee/onboarding/${app.id}`);
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }
  const after = () => {
    setDialog(null);
    void apiFetch<CrmLeadDto>(`crm/leads/${id}`).then(changed).catch(() => undefined);
  };

  return (
    <Drawer title={lead?.shopName ?? "Lead"} onClose={onClose}>
      {error && <p className={`${s.alert} ${s.alertError}`}>{error}</p>}
      {!lead ? <div className={s.skel} /> : (
        <>
          <div className={s.toolbar}>
            <LeadStatus status={lead.status} />
            <Pill>{pretty(lead.priority)} priority</Pill>
            {lead.interestLevel && <Pill tone="brand">Interest {lead.interestLevel}/5</Pill>}
            {lead.onboarding && <Pill tone="ok">{lead.onboarding.reference}</Pill>}
          </div>
          {canWrite && (
            <div className={s.toolbar}>
              {lead.phone && <a className={`${s.btn} ${s.btnSm}`} href={`tel:${lead.phone.replace(/\s/g, "")}`}>☎ Call</a>}
              {lead.whatsappPhone && <a className={`${s.btn} ${s.btnSm}`} href={`https://wa.me/${lead.whatsappPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setDialog("call")}>Log call</button>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setDialog("scheduleCall")}>Schedule call</button>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setDialog("meeting")}>Meeting</button>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setDialog("task")}>Task</button>
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setDialog("edit")}>Edit</button>
              {me?.role === "FIELD_EMPLOYEE" && <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => void startOnboarding()}>{lead.onboarding ? "Open onboarding" : "Start onboarding"}</button>}
            </div>
          )}
          {msg && <p className={`${s.alert} ${s.alertError}`} role="alert">{msg}</p>}
          <div className={s.formGrid} style={{ marginBottom: 14 }}>
            {canWrite && (
              <Field label="Status">
                <select className={s.select} value={lead.status} disabled={statusLocked} onChange={(e) => void patch({ status: e.target.value })}>
                  {(me?.role === "ADMIN" ? CRM_LEAD_STATUSES : CRM_MANUAL_LEAD_STATUSES.includes(lead.status) ? CRM_MANUAL_LEAD_STATUSES : [lead.status, ...CRM_MANUAL_LEAD_STATUSES]).map((st) => (
                    <option key={st} value={st}>{CRM_LEAD_STATUS_META[st].label}</option>
                  ))}
                </select>
                {statusLocked && <span className={s.faint}>Submitted for approval. A manager or admin can change this.</span>}
              </Field>
            )}
            {team && (
              <Field label="Assigned to">
                <select className={s.select} value={lead.assignedEmployee.id} onChange={(e) => void assign(e.target.value)}>
                  {!team.some((t) => t.id === lead.assignedEmployee.id) && <option value={lead.assignedEmployee.id}>{lead.assignedEmployee.fullName}</option>}
                  {team.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                </select>
              </Field>
            )}
          </div>
          <dl className={s.list} style={{ marginBottom: 16 }}>
            {(
              [
                ["Owner", lead.ownerName],
                ["Manager", lead.managerName],
                ["Phone", lead.phone],
                ["WhatsApp", lead.whatsappPhone],
                ["Email", lead.email],
                ["Address", [lead.addressLine, lead.locality, lead.city, lead.state, lead.postalCode].filter(Boolean).join(", ")],
                ["Chairs", lead.chairCount?.toString()],
                ["Current software", lead.existingSoftware],
                ["Territory", lead.territory],
                ["Source", pretty(lead.source)],
                ["Next action", lead.nextAction],
                ["Next follow-up", lead.nextFollowUpAt ? when(lead.nextFollowUpAt) : null],
                ["Last contacted", lead.lastContactedAt ? when(lead.lastContactedAt) : null],
                ["Contact attempts", String(lead.contactAttempts)],
                ["Meeting", lead.meetingAt ? when(lead.meetingAt) : null],
                ["Objections", lead.objections],
                ["Not-interested reason", lead.lostReason],
                ["Owner (CRM)", `${lead.assignedEmployee.fullName}${lead.assignedAt ? ` · since ${dayOnly(lead.assignedAt)}` : ""}`],
              ] as Array<[string, string | null | undefined]>
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className={s.listItem}><dt className={s.faint}>{k}</dt><dd style={{ margin: 0, textAlign: "right" }}>{v}</dd></div>
              ))}
          </dl>
          {lead.mapsUrl && <p><a className={s.link} href={lead.mapsUrl} target="_blank" rel="noreferrer">Open in Maps ↗</a></p>}
          <h3 className={s.cardTitle} style={{ margin: "16px 0 8px" }}>Timeline</h3>
          {canWrite && (
            <form onSubmit={addNote} className={s.toolbar}>
              <input className={`${s.input} ${s.search}`} placeholder="Add a note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              <button type="submit" className={`${s.btn} ${s.btnSm}`}>Add</button>
            </form>
          )}
          {!timeline.data ? <div className={s.skel} /> : timeline.data.length === 0 ? <p className={s.faint}>No activity yet.</p> : (
            <ul className={s.timeline}>
              {timeline.data.map((a) => (
                <li key={a.id}><span>{a.summary}<div className={s.faint}>{when(a.createdAt)}{a.actor ? ` · ${a.actor}` : ""}</div></span></li>
              ))}
            </ul>
          )}
          {dialog === "edit" && <LeadFormDialog lead={lead} onClose={() => setDialog(null)} onSaved={(l) => { setDialog(null); changed(l); }} />}
          {dialog === "call" && <CallLogDialog lead={lead} onClose={() => setDialog(null)} onSaved={after} />}
          {dialog === "scheduleCall" && <ScheduleCallDialog lead={lead} onClose={() => setDialog(null)} onSaved={after} />}
          {dialog === "meeting" && <MeetingDialog lead={lead} onClose={() => setDialog(null)} onSaved={after} />}
          {dialog === "task" && <TaskDialog lead={lead} onClose={() => setDialog(null)} onSaved={after} />}
        </>
      )}
    </Drawer>
  );
}

// ---------- Import (managers) ----------

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const team = useCrmData<CrmEmployeeRefDto[]>("crm/employees").data;
  const [file, setFile] = useState<File | null>(null);
  const [defaultEmployeeId, setDefault] = useState("");
  const [preview, setPreview] = useState<CrmImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<Array<string | null>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function runPreview(withMapping?: Array<string | null>) {
    if (!file) return setErr("Choose a CSV or Excel file.");
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (defaultEmployeeId) fd.append("defaultEmployeeId", defaultEmployeeId);
      if (withMapping) fd.append("mapping", JSON.stringify(withMapping));
      const p = await apiFetch<CrmImportPreviewDto>("crm/leads/import/preview", { method: "POST", body: fd });
      setPreview(p);
      setMapping(p.mapping);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ created: number; skipped: number }>(`crm/leads/imports/${preview.jobId}/commit`, { method: "POST", ...jsonBody({}) });
      setResult(`Imported ${r.created} lead(s); skipped ${r.skipped} (duplicates or errors).`);
      onDone();
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  async function template() {
    try {
      const { blob } = await apiFetchBlob("crm/leads/import/template.csv");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fastque-lead-import-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (ex) {
      setErr(errorText(ex));
    }
  }

  return (
    <Dialog title="Import leads" onClose={onClose}>
      {result ? (
        <>
          <p className={`${s.alert} ${s.alertOk}`} role="status">{result}</p>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onClose}>Done</button>
        </>
      ) : (
        <div className={s.form}>
          <p className={s.muted}>Upload a .csv or .xlsx. Review the column mapping and duplicates before anything is saved. <button type="button" className={s.link} onClick={() => void template()}>Download template</button></p>
          <Field label="File"><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></Field>
          <Field label="Assign rows without an employee to">
            <select className={s.select} value={defaultEmployeeId} onChange={(e) => setDefault(e.target.value)}>
              <option value="">— Choose —</option>
              {team?.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          </Field>
          {!preview && <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || !file} onClick={() => void runPreview()}>{busy ? "Reading…" : "Preview"}</button>}
          {preview && (
            <>
              <h3 className={s.cardTitle}>Column mapping</h3>
              <div className={s.formGrid}>
                {preview.headers.map((h, i) => (
                  <Field key={`${h}-${i}`} label={h || `Column ${i + 1}`}>
                    <select className={s.select} value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value || null : x)))}>
                      <option value="">Ignore</option>
                      {Object.entries(preview.fieldLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <button type="button" className={s.btn} disabled={busy} onClick={() => void runPreview(mapping)}>Re-check with this mapping</button>
              <p className={s.muted}>{preview.totalRows} rows · <strong>{preview.valid}</strong> new · {preview.duplicates} duplicates · {preview.errors} errors</p>
              <div className={s.tableWrap} style={{ maxHeight: 260 }}>
                <table className={s.table}>
                  <thead><tr><th>Row</th><th>Salon</th><th>Phone</th><th>City</th><th>Assign</th><th>Result</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td><td>{r.shopName ?? "—"}</td><td>{r.phone ?? "—"}</td><td>{r.city ?? "—"}</td><td>{r.assignTo ?? "—"}</td>
                        <td><Pill tone={r.status === "NEW" ? "ok" : r.status === "DUPLICATE" ? "warn" : "bad"}>{pretty(r.status)}</Pill>{r.issues.length > 0 && <div className={s.faint}>{r.issues.join("; ")}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy || preview.valid === 0} onClick={() => void commit()}>{busy ? "Importing…" : `Import ${preview.valid} lead(s)`}</button>
            </>
          )}
          {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}
