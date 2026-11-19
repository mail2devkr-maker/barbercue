"use client";

import { useState, type FormEvent } from "react";
import {
  CRM_CALL_OUTCOME_LABEL,
  CRM_TASK_TYPE_LABEL,
  CrmLeadPriority,
  type CrmCallDto,
  type CrmCallOutcome,
  type CrmEmployeeRefDto,
  type CrmMeetingDto,
  type CrmMeetingMode,
  type CrmTaskDto,
  type CrmTaskType,
} from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { errorText, fromLocalInput, jsonBody, toLocalInput, useCrmData } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { clean, Dialog, Field } from "./ui";
import s from "./crm.module.css";

export interface LeadRef {
  id: string;
  shopName: string;
}

/** Lead picker: search within the leads the caller may see. */
export function LeadPicker({ value, onChange }: { value: LeadRef | null; onChange: (lead: LeadRef | null) => void }) {
  const [q, setQ] = useState("");
  const { data } = useCrmData<{ items: LeadRef[] }>(value ? null : `crm/leads?limit=8&sort=updated${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
  if (value)
    return (
      <div className={s.toolbar} style={{ marginBottom: 0 }}>
        <strong>{value.shopName}</strong>
        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => onChange(null)}>Change</button>
      </div>
    );
  return (
    <div>
      <input className={s.input} placeholder="Search salon / phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
      <ul className={s.list} style={{ marginTop: 6 }}>
        {(data?.items ?? []).map((l) => (
          <li key={l.id} className={s.listItem}>
            <span>{l.shopName}</span>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => onChange({ id: l.id, shopName: l.shopName })}>Pick</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useTeam() {
  const me = useMe();
  return useCrmData<CrmEmployeeRefDto[]>(me?.can.viewTeam ? "crm/employees" : null).data;
}

function EmployeeSelect({ value, onChange, label = "Assign to" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const team = useTeam();
  if (!team) return null;
  return (
    <Field label={label}>
      <select className={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Choose employee —</option>
        {team.map((e) => (
          <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>
        ))}
      </select>
    </Field>
  );
}

// ---------- Task ----------

export function TaskDialog({ task, lead, onClose, onSaved }: { task?: CrmTaskDto; lead?: LeadRef | null; onClose: () => void; onSaved: (t: CrmTaskDto) => void }) {
  const [form, setForm] = useState({
    subject: task?.subject ?? "",
    description: task?.description ?? "",
    type: (task?.type ?? "OTHER") as CrmTaskType,
    priority: task?.priority ?? "NORMAL",
    dueAt: toLocalInput(task?.dueAt),
    assigneeEmployeeId: "",
  });
  const [pick, setPick] = useState<LeadRef | null>(task?.lead ?? lead ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = clean({ ...form, dueAt: fromLocalInput(form.dueAt), leadId: pick?.id ?? null }, !!task);
      if (task) delete (body as Record<string, unknown>).assigneeEmployeeId;
      const saved = await apiFetch<CrmTaskDto>(task ? `crm/tasks/${task.id}` : "crm/tasks", { method: task ? "PATCH" : "POST", ...jsonBody(body) });
      onSaved(saved);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={task ? `Edit ${task.code}` : "New task"} onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <Field label="Subject"><input className={s.input} required maxLength={200} value={form.subject} onChange={set("subject")} /></Field>
        <div className={s.formGrid}>
          <Field label="Type">
            <select className={s.select} value={form.type} onChange={set("type")}>
              {Object.entries(CRM_TASK_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={s.select} value={form.priority} onChange={set("priority")}>
              {Object.keys(CrmLeadPriority).map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
            </select>
          </Field>
          <Field label="Due"><input type="datetime-local" className={s.input} value={form.dueAt} onChange={set("dueAt")} /></Field>
          {!task && <EmployeeSelect value={form.assigneeEmployeeId} onChange={(v) => setForm((f) => ({ ...f, assigneeEmployeeId: v }))} />}
        </div>
        <Field label="Related lead (optional)"><LeadPicker value={pick} onChange={setPick} /></Field>
        <Field label="Description"><textarea className={s.textarea} maxLength={2000} value={form.description} onChange={set("description")} /></Field>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Save task"}</button>
      </form>
    </Dialog>
  );
}

// ---------- Meeting ----------

export function MeetingDialog({ meeting, lead, onClose, onSaved }: { meeting?: CrmMeetingDto; lead?: LeadRef | null; onClose: () => void; onSaved: (m: CrmMeetingDto) => void }) {
  const [form, setForm] = useState({
    startsAt: toLocalInput(meeting?.startsAt),
    endsAt: toLocalInput(meeting?.endsAt),
    mode: (meeting?.mode ?? "PHYSICAL") as CrmMeetingMode,
    location: meeting?.location ?? "",
    purpose: meeting?.purpose ?? "",
    agenda: meeting?.agenda ?? "",
    contactName: meeting?.contactName ?? "",
    contactPhone: meeting?.contactPhone ?? "",
    employeeId: "",
  });
  const [pick, setPick] = useState<LeadRef | null>(meeting?.lead ?? lead ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!meeting && !pick) return setErr("Pick the lead this meeting is for.");
    if (!form.startsAt) return setErr("Pick the meeting time.");
    setBusy(true);
    setErr(null);
    try {
      const base = clean({ ...form, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt) }, !!meeting);
      if (meeting) delete (base as Record<string, unknown>).employeeId;
      const body = meeting ? base : { ...base, leadId: pick!.id };
      const saved = await apiFetch<CrmMeetingDto>(meeting ? `crm/meetings/${meeting.id}` : "crm/meetings", { method: meeting ? "PATCH" : "POST", ...jsonBody(body) });
      onSaved(saved);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={meeting ? "Reschedule / edit meeting" : "Schedule meeting"} onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        {!meeting && <Field label="Lead"><LeadPicker value={pick} onChange={setPick} /></Field>}
        <div className={s.formGrid}>
          <Field label="Starts"><input type="datetime-local" className={s.input} required value={form.startsAt} onChange={set("startsAt")} /></Field>
          <Field label="Ends (optional)"><input type="datetime-local" className={s.input} value={form.endsAt} onChange={set("endsAt")} /></Field>
          <Field label="Mode">
            <select className={s.select} value={form.mode} onChange={set("mode")}>
              <option value="PHYSICAL">In person</option>
              <option value="ONLINE">Online</option>
              <option value="PHONE">Phone</option>
            </select>
          </Field>
          <Field label="Location / link"><input className={s.input} maxLength={300} value={form.location} onChange={set("location")} /></Field>
          <Field label="Contact person"><input className={s.input} maxLength={120} value={form.contactName} onChange={set("contactName")} /></Field>
          <Field label="Contact phone"><input className={s.input} inputMode="tel" value={form.contactPhone} onChange={set("contactPhone")} /></Field>
          {!meeting && <EmployeeSelect value={form.employeeId} onChange={(v) => setForm((f) => ({ ...f, employeeId: v }))} label="Meeting owner" />}
        </div>
        <Field label="Purpose"><input className={s.input} maxLength={200} value={form.purpose} onChange={set("purpose")} placeholder="Demo, pricing discussion, onboarding…" /></Field>
        <Field label="Agenda"><textarea className={s.textarea} maxLength={1000} value={form.agenda} onChange={set("agenda")} /></Field>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Save meeting"}</button>
      </form>
    </Dialog>
  );
}

/** Complete a meeting: outcome is required; optionally creates the follow-up task server-side. */
export function MeetingOutcomeDialog({ meeting, onClose, onSaved }: { meeting: CrmMeetingDto; onClose: () => void; onSaved: (m: CrmMeetingDto) => void }) {
  const [form, setForm] = useState({ status: "COMPLETED", outcome: meeting.outcome ?? "", notes: meeting.notes ?? "", nextAction: meeting.nextAction ?? "", followUpAt: toLocalInput(meeting.followUpAt), createFollowUpTask: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = clean({ ...form, followUpAt: fromLocalInput(form.followUpAt), createFollowUpTask: form.createFollowUpTask && !!form.followUpAt });
      onSaved(await apiFetch<CrmMeetingDto>(`crm/meetings/${meeting.id}`, { method: "PATCH", ...jsonBody(body) }));
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Meeting outcome — ${meeting.lead.shopName}`} onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <Field label="Result">
          <select className={s.select} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="COMPLETED">Completed</option>
            <option value="NO_SHOW">No show</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </Field>
        <Field label="Outcome"><textarea className={s.textarea} required={form.status === "COMPLETED"} maxLength={1000} value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))} placeholder="What was agreed? Objections? Owner's interest?" /></Field>
        <Field label="Notes"><textarea className={s.textarea} maxLength={2000} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        <div className={s.formGrid}>
          <Field label="Next action"><input className={s.input} maxLength={200} value={form.nextAction} onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value }))} /></Field>
          <Field label="Follow up on"><input type="datetime-local" className={s.input} value={form.followUpAt} onChange={(e) => setForm((f) => ({ ...f, followUpAt: e.target.value }))} /></Field>
        </div>
        <label className={s.check}><input type="checkbox" checked={form.createFollowUpTask} onChange={(e) => setForm((f) => ({ ...f, createFollowUpTask: e.target.checked }))} /> Create a follow-up task for that date</label>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Save outcome"}</button>
      </form>
    </Dialog>
  );
}

// ---------- Calls ----------

/**
 * Log the outcome of a phone call the employee made. FastQue does not place, record or monitor
 * phone calls; this is a manual log. With no existing call, schedules one "now" and logs it.
 */
export function CallLogDialog({ call, lead, onClose, onSaved }: { call?: CrmCallDto; lead?: LeadRef | null; onClose: () => void; onSaved: (c: CrmCallDto) => void }) {
  const [pick, setPick] = useState<LeadRef | null>(call?.lead ?? lead ?? null);
  const [form, setForm] = useState({ outcome: "" as CrmCallOutcome | "", durationMinutes: "", notes: "", nextCallbackAt: "", interestLevel: "", nextAction: "", meetingAt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pick) return setErr("Pick the lead you called.");
    if (!form.outcome) return setErr("Choose the call outcome.");
    setBusy(true);
    setErr(null);
    try {
      let id = call?.id;
      if (!id) id = (await apiFetch<CrmCallDto>("crm/calls", { method: "POST", ...jsonBody({ leadId: pick.id, scheduledAt: new Date().toISOString() }) })).id;
      const body = clean({
        outcome: form.outcome,
        durationSeconds: form.durationMinutes ? Math.round(Number(form.durationMinutes) * 60) : undefined,
        notes: form.notes,
        nextCallbackAt: fromLocalInput(form.nextCallbackAt) ?? undefined,
        interestLevel: form.interestLevel ? Number(form.interestLevel) : undefined,
        nextAction: form.nextAction,
        meetingAt: form.outcome === "MEETING_SCHEDULED" ? fromLocalInput(form.meetingAt) ?? undefined : undefined,
      });
      onSaved(await apiFetch<CrmCallDto>(`crm/calls/${id}/log`, { method: "POST", ...jsonBody(body) }));
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Log call outcome" onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        {!call && <Field label="Lead"><LeadPicker value={pick} onChange={setPick} /></Field>}
        {call && <p className={s.muted}>{call.lead.shopName}{call.lead.phone ? ` · ${call.lead.phone}` : ""}</p>}
        <Field label="Outcome">
          <select className={s.select} required value={form.outcome} onChange={set("outcome")}>
            <option value="">— Choose —</option>
            {Object.entries(CRM_CALL_OUTCOME_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {form.outcome === "MEETING_SCHEDULED" && <Field label="Meeting time"><input type="datetime-local" required className={s.input} value={form.meetingAt} onChange={set("meetingAt")} /></Field>}
        <div className={s.formGrid}>
          <Field label="Duration (minutes)"><input type="number" min={0} step={0.5} className={s.input} value={form.durationMinutes} onChange={set("durationMinutes")} /></Field>
          <Field label="Interest (1–5)">
            <select className={s.select} value={form.interestLevel} onChange={set("interestLevel")}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Callback at"><input type="datetime-local" className={s.input} value={form.nextCallbackAt} onChange={set("nextCallbackAt")} /></Field>
          <Field label="Next action"><input className={s.input} maxLength={200} value={form.nextAction} onChange={set("nextAction")} /></Field>
        </div>
        <Field label="Notes"><textarea className={s.textarea} maxLength={2000} value={form.notes} onChange={set("notes")} /></Field>
        <p className={s.faint}>This is a manual log. FastQue does not record phone calls.</p>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Save call"}</button>
      </form>
    </Dialog>
  );
}

/** Schedule a call for later (no outcome yet). */
export function ScheduleCallDialog({ lead, onClose, onSaved }: { lead?: LeadRef | null; onClose: () => void; onSaved: (c: CrmCallDto) => void }) {
  const [pick, setPick] = useState<LeadRef | null>(lead ?? null);
  const [at, setAt] = useState("");
  const [notes, setNotes] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pick || !at) return setErr("Pick a lead and a time.");
    setBusy(true);
    setErr(null);
    try {
      onSaved(await apiFetch<CrmCallDto>("crm/calls", { method: "POST", ...jsonBody(clean({ leadId: pick.id, scheduledAt: fromLocalInput(at), notes, employeeId })) }));
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Schedule call" onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <Field label="Lead"><LeadPicker value={pick} onChange={setPick} /></Field>
        <Field label="When"><input type="datetime-local" required className={s.input} value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} label="Caller" />
        <Field label="Notes"><textarea className={s.textarea} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Schedule"}</button>
      </form>
    </Dialog>
  );
}
