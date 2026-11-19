"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CRM_CALL_OUTCOME_LABEL,
  CRM_MEETING_STATUS_LABEL,
  CRM_TASK_STATUS_LABEL,
  CRM_TASK_TYPE_LABEL,
  CrmLeadPriority,
  CrmTaskStatus,
  type CrmCallDto,
  type CrmCallQueueDto,
  type CrmEmployeeRefDto,
  type CrmMeetingDto,
  type CrmPageDto,
  type CrmTaskDto,
} from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { errorText, jsonBody, pretty, queryParam, useCrmData, useQueryFlag, when } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { CallLogDialog, MeetingDialog, MeetingOutcomeDialog, ScheduleCallDialog, TaskDialog } from "./CrmForms";
import { Empty, Pager, Pill } from "./ui";
import s from "./crm.module.css";

const TASK_TONE: Record<string, "ok" | "warn" | "bad" | "brand" | undefined> = { COMPLETED: "ok", IN_PROGRESS: "brand", BLOCKED: "bad", CANCELLED: undefined, NOT_STARTED: "warn" };

// ---------- Tasks ----------

export function CrmTasks() {
  const me = useMe();
  const [view, setView] = useState<"table" | "board">("table");
  const [f, setF] = useState({ status: "NOT_STARTED,IN_PROGRESS,BLOCKED", type: "", priority: "", employeeId: "", overdue: queryParam("overdue") ? "true" : "", q: "" });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: view === "board" ? "200" : "50" });
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const { data, error, reload } = useCrmData<CrmPageDto<CrmTaskDto>>(`crm/tasks?${params}`);
  const team = useCrmData<CrmEmployeeRefDto[]>(me?.can.viewTeam ? "crm/employees" : null).data;
  const [creating, setCreating] = useQueryFlag("new");
  const [editing, setEditing] = useState<CrmTaskDto | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const canWrite = me?.role !== "VIEWER";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setPage(1);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  async function move(t: CrmTaskDto, status: string) {
    try {
      let blockedReason: string | null | undefined;
      if (status === "BLOCKED") {
        blockedReason = window.prompt("Why is this task blocked?") ?? undefined;
        if (!blockedReason) return;
      }
      await apiFetch(`crm/tasks/${t.id}`, { method: "PATCH", ...jsonBody({ status, ...(blockedReason ? { blockedReason } : {}) }) });
      reload();
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }
  async function bulk(status: string) {
    try {
      await apiFetch("crm/tasks/bulk", { method: "POST", ...jsonBody({ taskIds: selected, status }) });
      setSelected([]);
      reload();
    } catch (ex) {
      setMsg(errorText(ex));
    }
  }

  return (
    <>
      <div className={s.toolbar}>
        <div className={s.tabs} style={{ marginBottom: 0 }} role="tablist">
          {(["table", "board"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={`${s.tab} ${view === v ? s.tabOn : ""}`} onClick={() => setView(v)}>{v === "table" ? "List" : "Board"}</button>)}
        </div>
        <input className={`${s.input} ${s.search}`} placeholder="Search tasks" value={f.q} onChange={set("q")} aria-label="Search tasks" />
        <select className={s.select} value={f.status} onChange={set("status")} aria-label="Status">
          <option value="NOT_STARTED,IN_PROGRESS,BLOCKED">Open</option>
          <option value="">All</option>
          {Object.entries(CRM_TASK_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className={s.select} value={f.type} onChange={set("type")} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(CRM_TASK_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className={s.select} value={f.priority} onChange={set("priority")} aria-label="Priority">
          <option value="">Any priority</option>
          {Object.keys(CrmLeadPriority).map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
        </select>
        <label className={s.check}><input type="checkbox" checked={f.overdue === "true"} onChange={(e) => set("overdue")({ target: { value: e.target.checked ? "true" : "" } })} /> Overdue only</label>
        {team && (
          <select className={s.select} value={f.employeeId} onChange={set("employeeId")} aria-label="Employee">
            <option value="">All employees</option>
            {team.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </select>
        )}
        {canWrite && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setCreating(true)}>+ New task</button>}
      </div>
      {selected.length > 0 && canWrite && (
        <div className={`${s.alert} ${s.alertInfo}`} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong>{selected.length} selected</strong>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void bulk("COMPLETED")}>Mark completed</button>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void bulk("IN_PROGRESS")}>In progress</button>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void bulk("CANCELLED")}>Cancel</button>
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setSelected([])}>Clear</button>
        </div>
      )}
      {msg && <p className={`${s.alert} ${s.alertError}`} role="alert">{msg}</p>}
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      {!data ? <div className={s.skel} /> : data.items.length === 0 ? <Empty>No tasks here.</Empty> : view === "board" ? (
        <div className={s.kanban}>
          {(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const).map((col) => (
            <section key={col} className={s.kanbanCol} aria-label={CRM_TASK_STATUS_LABEL[col]}>
              <strong>{CRM_TASK_STATUS_LABEL[col]} · {data.items.filter((t) => t.status === col).length}</strong>
              {data.items.filter((t) => t.status === col).map((t) => (
                <article key={t.id} className={s.card} style={{ padding: 12 }}>
                  <button type="button" className={s.link} onClick={() => setEditing(t)}>{t.subject}</button>
                  <div className={s.faint}>{t.code} · {CRM_TASK_TYPE_LABEL[t.type]}{t.lead ? ` · ${t.lead.shopName}` : ""}</div>
                  <div className={s.faint} style={{ color: t.overdue ? "var(--c-bad)" : undefined }}>{t.dueAt ? `Due ${when(t.dueAt)}` : "No due date"}</div>
                  {canWrite && (
                    <select className={s.select} style={{ marginTop: 6 }} value={t.status} onChange={(e) => void move(t, e.target.value)} aria-label={`Move ${t.code}`}>
                      {Object.keys(CrmTaskStatus).map((st) => <option key={st} value={st}>{CRM_TASK_STATUS_LABEL[st as keyof typeof CRM_TASK_STATUS_LABEL]}</option>)}
                    </select>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                {canWrite && <th aria-label="Select" />}
                <th>Task</th><th>Type</th><th>Lead</th><th>Priority</th><th>Due</th><th>Status</th>{team && <th>Assignee</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id}>
                  {canWrite && <td><input type="checkbox" aria-label={`Select ${t.code}`} checked={selected.includes(t.id)} onChange={(e) => setSelected((c) => (e.target.checked ? [...c, t.id] : c.filter((x) => x !== t.id)))} /></td>}
                  <td><button type="button" className={s.link} onClick={() => setEditing(t)}>{t.subject}</button><div className={s.faint}>{t.code}{t.blockedReason ? ` · Blocked: ${t.blockedReason}` : ""}</div></td>
                  <td>{CRM_TASK_TYPE_LABEL[t.type]}</td>
                  <td>{t.lead?.shopName ?? "—"}</td>
                  <td>{pretty(t.priority)}</td>
                  <td style={{ color: t.overdue ? "var(--c-bad)" : undefined }}>{t.dueAt ? when(t.dueAt) : "—"}</td>
                  <td>
                    {canWrite ? (
                      <select className={s.select} value={t.status} onChange={(e) => void move(t, e.target.value)} aria-label={`Status of ${t.code}`}>
                        {Object.keys(CrmTaskStatus).map((st) => <option key={st} value={st}>{CRM_TASK_STATUS_LABEL[st as keyof typeof CRM_TASK_STATUS_LABEL]}</option>)}
                      </select>
                    ) : <Pill tone={TASK_TONE[t.status]}>{CRM_TASK_STATUS_LABEL[t.status]}</Pill>}
                  </td>
                  {team && <td>{t.assignee.fullName}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && view === "table" && <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      {(creating || editing) && (
        <TaskDialog
          task={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

// ---------- Meetings ----------

export function CrmMeetings({ base = "/employee" }: { base?: string }) {
  const me = useMe();
  const [range, setRange] = useState<"upcoming" | "past">("upcoming");
  const nowIso = useState(() => new Date().toISOString())[0];
  const path = range === "upcoming" ? `crm/meetings?from=${encodeURIComponent(nowIso)}` : `crm/meetings?to=${encodeURIComponent(nowIso)}`;
  const { data, error, reload } = useCrmData<CrmMeetingDto[]>(path);
  const [creating, setCreating] = useQueryFlag("new");
  const [editing, setEditing] = useState<CrmMeetingDto | null>(null);
  const [outcome, setOutcome] = useState<CrmMeetingDto | null>(null);
  const canWrite = me?.role !== "VIEWER";
  const items = data ? (range === "past" ? [...data].reverse() : data) : null;
  const byDay = new Map<string, CrmMeetingDto[]>();
  for (const m of items ?? []) {
    const k = when(m.startsAt, { weekday: "long", day: "numeric", month: "long" });
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }
  return (
    <>
      <div className={s.toolbar}>
        <div className={s.tabs} style={{ marginBottom: 0 }} role="tablist">
          {(["upcoming", "past"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={range === v} className={`${s.tab} ${range === v ? s.tabOn : ""}`} onClick={() => setRange(v)}>{v === "upcoming" ? "Upcoming" : "Past"}</button>)}
        </div>
        {canWrite && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setCreating(true)}>+ Schedule meeting</button>}
      </div>
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      {!items ? <div className={s.skel} /> : items.length === 0 ? <Empty>No meetings {range === "upcoming" ? "scheduled" : "yet"}.</Empty> : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className={s.card} style={{ marginBottom: 12 }}>
            <h2 className={s.cardTitle} style={{ marginBottom: 8 }}>{day}</h2>
            <ul className={s.list}>
              {list.map((m) => (
                <li key={m.id} className={s.listItem} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <span>
                    <strong>{when(m.startsAt, { hour: "numeric", minute: "2-digit" })} · {m.lead.shopName}</strong>
                    <div className={s.faint}>{pretty(m.mode)}{m.location ? ` · ${m.location}` : ""}{m.purpose ? ` · ${m.purpose}` : ""}{me?.can.viewTeam ? ` · ${m.employee.fullName}` : ""}</div>
                    {m.outcome && <div className={s.muted}>Outcome: {m.outcome}</div>}
                  </span>
                  <span className={s.toolbar} style={{ marginBottom: 0 }}>
                    <Pill tone={m.status === "COMPLETED" ? "ok" : m.status === "CANCELLED" || m.status === "NO_SHOW" ? "bad" : "brand"}>{CRM_MEETING_STATUS_LABEL[m.status]}</Pill>
                    {canWrite && !["COMPLETED", "CANCELLED"].includes(m.status) && (
                      <>
                        {m.status === "SCHEDULED" && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void apiFetch(`crm/meetings/${m.id}`, { method: "PATCH", ...jsonBody({ status: "CONFIRMED" }) }).then(reload)}>Confirm</button>}
                        <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setEditing(m)}>Reschedule</button>
                        <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => setOutcome(m)}>Record outcome</button>
                        {me?.role === "FIELD_EMPLOYEE" && <Link className={`${s.btn} ${s.btnSm}`} href={`${base}/conversations?new=1&lead=${m.lead.id}&meeting=${m.id}`}>🎙 Record conversation</Link>}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {(creating || editing) && <MeetingDialog meeting={editing ?? undefined} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); reload(); }} />}
      {outcome && <MeetingOutcomeDialog meeting={outcome} onClose={() => setOutcome(null)} onSaved={() => { setOutcome(null); reload(); }} />}
    </>
  );
}

// ---------- Calls ----------

export function CrmCalls() {
  const me = useMe();
  const queue = useCrmData<CrmCallQueueDto>("crm/calls/queue");
  const since = useState(() => new Date(Date.now() - 7 * 864e5).toISOString())[0];
  const history = useCrmData<CrmCallDto[]>(`crm/calls?from=${encodeURIComponent(since)}`);
  const [scheduling, setScheduling] = useQueryFlag("new");
  const [logging, setLogging] = useState<{ call?: CrmCallDto; lead?: { id: string; shopName: string } } | null>(null);
  const canWrite = me?.role !== "VIEWER";
  const reload = () => {
    queue.reload();
    history.reload();
  };
  const row = (c: CrmCallDto) => (
    <li key={c.id} className={s.listItem} style={{ flexWrap: "wrap", gap: 8 }}>
      <span>
        <strong>{c.lead.shopName}</strong>
        <div className={s.faint}>{c.lead.contactName ?? ""} {c.lead.phone ?? "No phone"} · attempts {c.lead.contactAttempts}{me?.can.viewTeam ? ` · ${c.employee.fullName}` : ""}</div>
        {c.notes && <div className={s.muted}>{c.notes}</div>}
      </span>
      <span className={s.toolbar} style={{ marginBottom: 0 }}>
        <Pill tone={c.overdue ? "bad" : "warn"}>{c.overdue ? "Overdue" : when(c.scheduledAt)}</Pill>
        {c.lead.phone && <a className={`${s.btn} ${s.btnSm}`} href={`tel:${c.lead.phone.replace(/\s/g, "")}`}>☎ Call</a>}
        {canWrite && <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => setLogging({ call: c })}>Log outcome</button>}
      </span>
    </li>
  );
  return (
    <>
      <div className={s.toolbar}>
        {canWrite && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setLogging({})}>+ Log a call</button>}
        {canWrite && <button type="button" className={s.btn} onClick={() => setScheduling(true)}>Schedule call</button>}
        <span className={s.faint}>Tap ☎ to dial from your phone, then log what happened. FastQue does not record phone calls.</span>
      </div>
      {queue.error && <p className={`${s.alert} ${s.alertError}`} role="alert">{queue.error}</p>}
      <div className={s.grid2}>
        <section className={s.card} aria-label="Overdue calls">
          <h2 className={s.cardTitle} style={{ marginBottom: 8 }}>Overdue · {queue.data?.overdue.length ?? "…"}</h2>
          {!queue.data ? <div className={s.skel} /> : queue.data.overdue.length === 0 ? <p className={s.faint}>None.</p> : <ul className={s.list}>{queue.data.overdue.map(row)}</ul>}
        </section>
        <section className={s.card} aria-label="Due calls">
          <h2 className={s.cardTitle} style={{ marginBottom: 8 }}>Due today · {queue.data?.due.length ?? "…"}</h2>
          {!queue.data ? <div className={s.skel} /> : queue.data.due.length === 0 ? <p className={s.faint}>None.</p> : <ul className={s.list}>{queue.data.due.map(row)}</ul>}
        </section>
      </div>
      <section className={s.card} style={{ marginTop: 16 }} aria-label="Leads never called">
        <h2 className={s.cardTitle} style={{ marginBottom: 8 }}>Leads waiting for a first call</h2>
        {!queue.data ? <div className={s.skel} /> : queue.data.uncalledLeads.length === 0 ? <p className={s.faint}>Every lead has been called or scheduled.</p> : (
          <ul className={s.list}>
            {queue.data.uncalledLeads.map((l) => (
              <li key={l.id} className={s.listItem}>
                <span><strong>{l.shopName}</strong><div className={s.faint}>{l.contactName ?? ""} {l.phone ?? "No phone"}</div></span>
                <span className={s.toolbar} style={{ marginBottom: 0 }}>
                  {l.phone && <a className={`${s.btn} ${s.btnSm}`} href={`tel:${l.phone.replace(/\s/g, "")}`}>☎ Call</a>}
                  {canWrite && <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setLogging({ lead: l })}>Log outcome</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={s.card} style={{ marginTop: 16 }} aria-label="Call history">
        <h2 className={s.cardTitle} style={{ marginBottom: 8 }}>Last 7 days</h2>
        {!history.data ? <div className={s.skel} /> : history.data.filter((c) => c.outcome).length === 0 ? <p className={s.faint}>No calls logged.</p> : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>When</th><th>Salon</th><th>Outcome</th><th>Duration</th><th>Interest</th><th>Notes</th></tr></thead>
              <tbody>
                {history.data.filter((c) => c.outcome).map((c) => (
                  <tr key={c.id}>
                    <td>{when(c.calledAt)}</td><td>{c.lead.shopName}</td><td>{CRM_CALL_OUTCOME_LABEL[c.outcome!]}</td>
                    <td>{c.durationSeconds != null ? `${Math.round(c.durationSeconds / 60)} min` : "—"}</td><td>{c.interestLevel ?? "—"}</td><td>{c.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {scheduling && <ScheduleCallDialog onClose={() => setScheduling(false)} onSaved={() => { setScheduling(false); reload(); }} />}
      {logging && <CallLogDialog call={logging.call} lead={logging.lead} onClose={() => setLogging(null)} onSaved={() => { setLogging(null); reload(); }} />}
    </>
  );
}
