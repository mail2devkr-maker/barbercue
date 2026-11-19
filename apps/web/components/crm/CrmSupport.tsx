"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CrmLeadPriority,
  SUPPORT_CATEGORY_LABEL,
  SUPPORT_OPEN_STATUSES,
  SUPPORT_STATUS_LABEL,
  type CrmPageDto,
  type SupportTicketCategory,
  type SupportTicketDto,
  type SupportTicketStatus,
} from "@barbercue/shared";
import { apiFetch, apiFetchBlob } from "../../lib/api";
import { errorText, jsonBody, pretty, queryParam, useCrmData, useQueryFlag, when } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { LeadPicker, type LeadRef } from "./CrmForms";
import { Dialog, Drawer, Empty, Field, Pager, Pill } from "./ui";
import s from "./crm.module.css";

const STATUS_TONE = (st: SupportTicketStatus) => (st === "RESOLVED" || st === "CLOSED" ? "ok" : st === "REOPENED" ? "bad" : st.startsWith("WAITING") ? "warn" : "brand");

/** Support tickets: employees raise and follow theirs; support staff (managers/admins) work the queue. */
export function CrmSupport() {
  const me = useMe();
  const [f, setF] = useState({ status: SUPPORT_OPEN_STATUSES.join(","), category: "", mine: "" });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: "25" });
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const { data, error, reload } = useCrmData<CrmPageDto<SupportTicketDto>>(`crm/tickets?${params}`);
  const [creating, setCreating] = useQueryFlag("new");
  const [openId, setOpenId] = useState<string | null>(() => queryParam("ticket"));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setPage(1);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  return (
    <>
      <div className={s.toolbar}>
        <select className={s.select} value={f.status} onChange={set("status")} aria-label="Status">
          <option value={SUPPORT_OPEN_STATUSES.join(",")}>Open</option>
          <option value="RESOLVED,CLOSED">Resolved / closed</option>
          <option value="">All</option>
          {Object.entries(SUPPORT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className={s.select} value={f.category} onChange={set("category")} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(SUPPORT_CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {me?.can.manageTickets && (
          <select className={s.select} value={f.mine} onChange={set("mine")} aria-label="Whose">
            <option value="">All tickets</option>
            <option value="true">Assigned to me</option>
          </select>
        )}
        {me?.role !== "VIEWER" && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setCreating(true)}>+ New ticket</button>}
      </div>
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      {!data ? <div className={s.skel} /> : data.items.length === 0 ? <Empty>No tickets here.</Empty> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Ticket</th><th>Category</th><th>Priority</th><th>Status</th><th>SLA</th>{me?.can.manageTickets && <th>Raised by</th>}<th>Updated</th></tr></thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} onClick={() => setOpenId(t.id)} style={{ cursor: "pointer" }}>
                  <td><strong>{t.subject}</strong><div className={s.faint}>{t.code}{t.lead ? ` · ${t.lead.shopName}` : ""}</div></td>
                  <td>{SUPPORT_CATEGORY_LABEL[t.category]}</td>
                  <td>{pretty(t.priority)}{t.escalatedAt ? " ⚑" : ""}</td>
                  <td><Pill tone={STATUS_TONE(t.status)}>{SUPPORT_STATUS_LABEL[t.status]}</Pill></td>
                  <td>{SUPPORT_OPEN_STATUSES.includes(t.status) ? <Pill tone={t.slaBreached ? "bad" : undefined}>{t.slaBreached ? "Breached" : `Due ${when(t.slaDueAt)}`}</Pill> : "—"}</td>
                  {me?.can.manageTickets && <td>{t.createdBy.name ?? "—"}</td>}
                  <td>{when(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      {creating && <NewTicketDialog onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); reload(); setOpenId(t.id); }} />}
      {openId && <TicketDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function NewTicketDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (t: SupportTicketDto) => void }) {
  const [form, setForm] = useState({ category: "" as SupportTicketCategory | "", subject: "", description: "", priority: "NORMAL" });
  const [lead, setLead] = useState<LeadRef | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.category) return setErr("Choose a category.");
    setBusy(true);
    setErr(null);
    try {
      const t = await apiFetch<SupportTicketDto>("crm/tickets", { method: "POST", ...jsonBody({ ...form, leadId: lead?.id ?? null }) });
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await apiFetch(`crm/tickets/${t.id}/attachments`, { method: "POST", body: fd }).catch(() => undefined);
      }
      onSaved(t);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="New support ticket" onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <div className={s.formGrid}>
          <Field label="Category">
            <select className={s.select} required value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SupportTicketCategory }))}>
              <option value="">— Choose —</option>
              {Object.entries(SUPPORT_CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={s.select} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              {Object.keys(CrmLeadPriority).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Subject"><input className={s.input} required maxLength={200} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></Field>
        <Field label="What happened?"><textarea className={s.textarea} required maxLength={5000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <Field label="Related salon lead (optional)"><LeadPicker value={lead} onChange={setLead} /></Field>
        <Field label="Screenshot (optional, image)"><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Sending…" : "Create ticket"}</button>
      </form>
    </Dialog>
  );
}

function TicketDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const me = useMe();
  const { data: t, error, setData } = useCrmData<SupportTicketDto>(`crm/tickets/${id}`);
  const agents = useCrmData<Array<{ id: string; name: string | null }>>(me?.can.manageTickets ? "crm/tickets/agents" : null).data;
  const [comment, setComment] = useState({ body: "", internal: false });
  const [resolution, setResolution] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => () => Object.values(images).forEach((u) => URL.revokeObjectURL(u)), [images]);

  async function update(body: Record<string, unknown>) {
    setErr(null);
    try {
      setData(await apiFetch<SupportTicketDto>(`crm/tickets/${id}`, { method: "PATCH", ...jsonBody(body) }));
      onChanged();
    } catch (ex) {
      setErr(errorText(ex));
    }
  }
  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.body.trim()) return;
    try {
      setData(await apiFetch<SupportTicketDto>(`crm/tickets/${id}/comments`, { method: "POST", ...jsonBody({ body: comment.body.trim(), internal: comment.internal }) }));
      setComment({ body: "", internal: false });
    } catch (ex) {
      setErr(errorText(ex));
    }
  }
  async function attach(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      setData(await apiFetch<SupportTicketDto>(`crm/tickets/${id}/attachments`, { method: "POST", body: fd }));
    } catch (ex) {
      setErr(errorText(ex));
    }
  }
  async function view(attId: string) {
    try {
      const { blob } = await apiFetchBlob(`crm/tickets/${id}/attachments/${attId}`);
      setImages((m) => ({ ...m, [attId]: URL.createObjectURL(blob) }));
    } catch (ex) {
      setErr(errorText(ex));
    }
  }
  const isOwner = t && me && !me.can.manageTickets;
  const open = t && SUPPORT_OPEN_STATUSES.includes(t.status);

  return (
    <Drawer title={t ? `${t.code} · ${t.subject}` : "Ticket"} onClose={onClose}>
      {error && <p className={`${s.alert} ${s.alertError}`}>{error}</p>}
      {!t ? <div className={s.skel} /> : (
        <>
          <div className={s.toolbar}>
            <Pill tone={STATUS_TONE(t.status)}>{SUPPORT_STATUS_LABEL[t.status]}</Pill>
            <Pill>{SUPPORT_CATEGORY_LABEL[t.category]}</Pill>
            <Pill>{pretty(t.priority)}</Pill>
            {open && <Pill tone={t.slaBreached ? "bad" : undefined}>{t.slaBreached ? "SLA breached" : `SLA ${when(t.slaDueAt)}`}</Pill>}
            {t.escalatedAt && <Pill tone="bad">Escalated</Pill>}
          </div>
          <p className={s.muted} style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>
          <p className={s.faint}>Raised by {t.createdBy.name ?? "—"} · {when(t.createdAt)}{t.lead ? ` · ${t.lead.shopName}` : ""}{t.assignedTo ? ` · Assigned to ${t.assignedTo.name ?? "—"}` : ""}</p>
          {t.resolutionNotes && <p className={`${s.alert} ${s.alertOk}`}>Resolution: {t.resolutionNotes}</p>}
          {me?.can.manageTickets && (
            <div className={s.formGrid} style={{ marginBottom: 12 }}>
              <Field label="Status">
                <select className={s.select} value={t.status} onChange={(e) => void update({ status: e.target.value, ...(resolution ? { resolutionNotes: resolution } : {}) })}>
                  {Object.entries(SUPPORT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Assigned to">
                <select className={s.select} value={t.assignedTo?.id ?? ""} onChange={(e) => void update({ assignedToUserId: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {agents?.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.id}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className={s.select} value={t.priority} onChange={(e) => void update({ priority: e.target.value })}>
                  {Object.keys(CrmLeadPriority).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
                </select>
              </Field>
              <Field label="Resolution notes (sent when resolving)" wide><textarea className={s.textarea} maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
            </div>
          )}
          <div className={s.toolbar}>
            {open && !t.escalatedAt && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void update({ escalate: true })}>Escalate</button>}
            {me?.can.manageTickets && open && <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => void update({ status: "RESOLVED", resolutionNotes: resolution || undefined })}>Resolve</button>}
            {isOwner && t.status === "RESOLVED" && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void update({ status: "CLOSED" })}>Confirm fixed & close</button>}
            {(t.status === "RESOLVED" || t.status === "CLOSED") && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void update({ status: "REOPENED" })}>Reopen</button>}
            {me?.role !== "VIEWER" && (
              <label className={`${s.btn} ${s.btnSm}`}>
                Attach image
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
              </label>
            )}
          </div>
          {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
          {t.attachments.length > 0 && (
            <div className={s.toolbar}>
              {t.attachments.map((a) => images[a.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={images[a.id]} alt="Ticket attachment" style={{ maxWidth: 180, borderRadius: 10 }} />
              ) : (
                <button key={a.id} type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void view(a.id)}>🖼 View ({Math.round(a.sizeBytes / 1024)} KB)</button>
              ))}
            </div>
          )}
          <h3 className={s.cardTitle} style={{ margin: "14px 0 8px" }}>Conversation</h3>
          {t.comments.length === 0 ? <p className={s.faint}>No replies yet.</p> : (
            <ul className={s.timeline}>
              {t.comments.map((c) => (
                <li key={c.id}><span style={{ whiteSpace: "pre-wrap" }}>{c.internal && <Pill tone="warn">Internal</Pill>} {c.body}<div className={s.faint}>{c.author ?? "—"} · {when(c.createdAt)}</div></span></li>
              ))}
            </ul>
          )}
          {me?.role !== "VIEWER" && (
            <form className={s.form} onSubmit={addComment} style={{ marginTop: 10 }}>
              <textarea className={s.textarea} placeholder="Write a reply" maxLength={5000} value={comment.body} onChange={(e) => setComment((c) => ({ ...c, body: e.target.value }))} aria-label="Reply" />
              {me?.can.manageTickets && <label className={s.check}><input type="checkbox" checked={comment.internal} onChange={(e) => setComment((c) => ({ ...c, internal: e.target.checked }))} /> Internal note (hidden from the employee)</label>}
              <button type="submit" className={s.btn}>Send reply</button>
            </form>
          )}
        </>
      )}
    </Drawer>
  );
}
