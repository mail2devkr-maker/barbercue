"use client";

import { useEffect, useState } from "react";
import { CONNECT_FEATURES, formatPaise, type ConnectPlatformConfigDto } from "@barbercue/shared";
import { connectApi, connectErrorText, whenLabel } from "../../lib/connect";
import s from "./connect.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any -- read-only rendering of a server report */
const usd = (micro: number | null | undefined) => (micro == null ? "No data yet" : `US$${(micro / 1_000_000).toFixed(4)}`);
const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** FastQue admin → Communication Management. Aggregates only; reading a conversation needs a stated, audited purpose. */
export function AdminConnect() {
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState("week");
  const [o, setO] = useState<any>(null);
  const [cfg, setCfg] = useState<ConnectPlatformConfigDto | null>(null);
  const [reports, setReports] = useState<any[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [access, setAccess] = useState({ conversationId: "", purpose: "SUPPORT_TICKET", reference: "", justification: "" });
  const [transcript, setTranscript] = useState<any>(null);

  useEffect(() => {
    if (tab === "overview") connectApi(`admin/overview?period=${period}`).then(setO).catch((e) => setMsg(connectErrorText(e)));
    if (tab === "config") connectApi<ConnectPlatformConfigDto>("admin/config").then(setCfg).catch((e) => setMsg(connectErrorText(e)));
    if (tab === "moderation") connectApi<any[]>("admin/reports?status=OPEN").then(setReports).catch((e) => setMsg(connectErrorText(e)));
  }, [tab, period]);

  const saveCfg = async (patch: Record<string, unknown>) => {
    try {
      setCfg(await connectApi<ConnectPlatformConfigDto>("admin/config", "PUT", patch));
      setMsg("Configuration saved (audited).");
    } catch (e) {
      setMsg(connectErrorText(e));
    }
  };
  const num = (group: keyof ConnectPlatformConfigDto, key: string, label: string, hint?: string) => (
    <label className={s.field} key={`${group}.${key}`}>{label}
      <input className={s.input} type="number" defaultValue={(cfg![group] as unknown as Record<string, number>)[key]} onBlur={(e) => void saveCfg({ [group]: { [key]: Number(e.target.value) } })} />
      {hint && <span className={s.muted}>{hint}</span>}
    </label>
  );

  return (
    <div className={`${s.root} ${s.darkDefault} ${s.page}`}>
      <h1 className={s.h1}>Communication Management</h1>
      <nav className={s.tabs} aria-label="Sections">
        {[["overview", "Overview"], ["config", "Configuration"], ["moderation", "Moderation"], ["access", "Purpose-limited access"]].map(([id, l]) => <button key={id} type="button" className={s.tab} aria-pressed={tab === id} onClick={() => { setTab(id); setMsg(null); }}>{l}</button>)}
      </nav>
      {msg && <p className={s.banner} role="status">{msg}</p>}

      {tab === "overview" && (
        !o ? <div className={s.skeleton} /> : (
          <>
            <div className={s.tabs}>{["day", "week", "month"].map((p) => <button key={p} type="button" className={s.tab} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p === "day" ? "Today" : p === "week" ? "7 days" : "30 days"}</button>)}</div>
            <p className={s.muted}>Switches: {Object.entries(o.flags).map(([k, v]) => `${k.replace(/^CONNECT_|_ENABLED$/g, "").toLowerCase()} ${v ? "on" : "off"}`).join(" · ")}. AI provider: {o.model.provider}{o.model.fastModel ? ` (${o.model.fastModel})` : ""}{o.model.configured ? "" : ", not configured: replies use rules only"}.</p>
            <div className={s.stats}>
              {([
                ["Total conversations", o.totals.conversations], ["Salons active in period", o.totals.activeSalons], ["Messages in period", o.totals.messages], ["AI messages", o.totals.aiMessages],
                ["Unanswered conversations", o.totals.unansweredConversations], ["Open abuse reports", o.totals.openAbuseReports], ["Media stored", `${bytes(o.totals.mediaBytes)} · ${o.totals.mediaFiles} files`],
                ["Translations", o.totals.translations], ["AI cost", usd(o.ai.totalCostMicroUsd)], ["AI cost per conversation", usd(o.ai.costPerConversationMicroUsd)],
                ["Revenue from chat workflows", formatPaise(o.totals.revenueFromWorkflowsPaise)], ["Satisfaction", o.totals.satisfactionAverage ?? "No data yet"],
              ] as [string, string | number][]).map(([l, v]) => <div key={l} className={s.stat}><span className={s.muted}>{l}</span><span className={s.statValue}>{v}</span></div>)}
            </div>
            <section className={s.card}><b>AI usage by engine</b>
              <table className={s.table}><thead><tr><th>Engine</th><th>Calls</th><th>Tokens in/out</th><th>Cost</th></tr></thead>
                <tbody>{o.ai.byEngine.map((e: any) => <tr key={e.engine}><td>{e.engine}</td><td>{e.calls}</td><td>{e.inputTokens} / {e.outputTokens}</td><td>{usd(e.costMicroUsd)}</td></tr>)}</tbody></table>
              {o.ai.topSalons.length > 0 && <><b>AI cost per salon</b>{o.ai.topSalons.map((x: any) => <div key={x.salonId} className={s.between}><span>{x.name ?? x.salonId}</span><b>{usd(x.costMicroUsd)}</b></div>)}</>}
            </section>
            <section className={s.card}><b>Slowest first replies</b>{o.slowestSalons.length ? o.slowestSalons.map((x: any) => <div key={x.salonId} className={s.between}><span>{x.name}</span><span>{Math.round(x.avgFirstResponseSeconds / 60)} min avg · {x.samples}</span></div>) : <span className={s.muted}>No data yet</span>}</section>
            <section className={s.card}><b>Complaints by category</b>{o.complaints.length ? o.complaints.map((c: any) => <div key={c.category} className={s.between}><span>{c.category}</span><b>{c.count}</b></div>) : <span className={s.muted}>No data yet</span>}</section>
            <section className={s.card}><b>Notification deliveries</b>{o.notifications.length ? o.notifications.map((n: any) => <div key={n.status} className={s.between}><span>{n.status}</span><b>{n.count}</b></div>) : <span className={s.muted}>No data yet</span>}</section>
          </>
        )
      )}

      {tab === "config" && cfg && (
        <div className={s.stats} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}>
          <section className={s.card}><b>Lifecycle</b>
            {num("lifecycle", "activeDaysAfterCompletion", "Days a chat stays open after the visit")}
            {num("lifecycle", "cancelledWindowDays", "Days a chat stays open after a cancellation")}
            <label className={s.row}><input type="checkbox" checked={cfg.lifecycle.completedChatAllowed} onChange={(e) => void saveCfg({ lifecycle: { completedChatAllowed: e.target.checked } })} /> Customers may start a chat on completed bookings</label>
          </section>
          <section className={s.card}><b>Limits</b>
            {num("limits", "maxMessageChars", "Max characters per message")}
            {num("limits", "messagesPerMinute", "Messages per person per minute")}
            {num("limits", "maxAttachmentBytes", "Max photo/PDF size (bytes)", "Limited to 25 MB by the server.")}
            {num("limits", "maxVoiceBytes", "Max voice note size (bytes)")}
            {num("limits", "retentionDays", "Retention (days)", "Recorded policy. Automatic deletion is not switched on.")}
          </section>
          <section className={s.card}><b>AI</b>
            <label className={s.row}><input type="checkbox" checked={cfg.ai.salonAiAllowed} onChange={(e) => void saveCfg({ ai: { salonAiAllowed: e.target.checked } })} /> Salons may use automatic AI replies</label>
            {num("ai", "monthlyBudgetUsdPerSalon", "Monthly AI budget per salon (US$)")}
            {num("ai", "confidenceThreshold", "Confidence needed for an automatic reply (0.5–0.99)")}
            {num("quotas", "aiRepliesPerSalonPerDay", "AI replies per salon per day")}
            {num("quotas", "translationsPerSalonPerDay", "Translations per salon per day")}
            <span className={s.muted}>The provider, model and prices are set in server configuration (CONNECT_AI_*), never in the browser.</span>
          </section>
          <section className={s.card}><b>Notifications, moderation and escalation</b>
            {num("notifications", "unreadThrottleMinutes", "Minutes between unread-message notices per chat")}
            {num("notifications", "queuePositionStep", "Queue positions moved before a chat update")}
            {num("notifications", "queueWaitIncreaseMinutes", "Wait increase (min) before a delay message")}
            <label className={s.row}><input type="checkbox" checked={cfg.moderation.blockLinksFromCustomers} onChange={(e) => void saveCfg({ moderation: { blockLinksFromCustomers: e.target.checked } })} /> Block links in customer messages</label>
            {num("escalation", "complaintSlaHours", "Complaint resolution target (hours)")}
          </section>
          <section className={s.card}><b>Plan features (no prices; nothing is charged)</b>
            <label className={s.field}>Tier every salon gets now
              <select className={s.input} value={cfg.entitlements.defaultTier} onChange={(e) => void saveCfg({ entitlements: { defaultTier: e.target.value } })}>
                {["BASIC", "PROFESSIONAL", "PREMIUM"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            {(["BASIC", "PROFESSIONAL", "PREMIUM"] as const).map((t) => <span key={t} className={s.muted}><b>{t}:</b> {cfg.entitlements.tiers[t].length === CONNECT_FEATURES.length ? "everything" : cfg.entitlements.tiers[t].join(", ").toLowerCase().replace(/_/g, " ")}</span>)}
          </section>
        </div>
      )}

      {tab === "moderation" && (
        <section className={s.card}>
          <b>Open abuse and spam reports</b>
          <span className={s.muted}>Only the report is shown. To read the conversation, use purpose-limited access with the report as the reason.</span>
          {!reports ? <div className={s.skeleton} /> : reports.length === 0 ? <span className={s.muted}>No open reports.</span> : (
            <table className={s.table}><thead><tr><th>When</th><th>Reason</th><th>Conversation</th><th /></tr></thead>
              <tbody>{reports.map((r) => (
                <tr key={r.id}><td>{whenLabel(r.createdAt)}</td><td>{r.reason}{r.details ? `: ${r.details}` : ""}</td><td><code>{r.conversationId.slice(0, 8)}</code></td>
                  <td className={s.row}>
                    {["DISMISSED", "REVIEWED"].map((st) => <button key={st} className={`${s.ghost} ${s.small}`} onClick={() => void connectApi(`admin/reports/${r.id}/review`, "POST", { status: st, hideMessage: false }).then(() => setReports(reports.filter((x) => x.id !== r.id)))}>{st.toLowerCase()}</button>)}
                    {r.messageId && <button className={`${s.ghost} ${s.small}`} onClick={() => window.confirm("Hide the reported message for everyone?") && void connectApi(`admin/reports/${r.id}/review`, "POST", { status: "ACTIONED", hideMessage: true }).then(() => setReports(reports.filter((x) => x.id !== r.id)))}>Hide message</button>}
                  </td></tr>
              ))}</tbody></table>
          )}
        </section>
      )}

      {tab === "access" && (
        <section className={s.card}>
          <b>Read one conversation for a documented reason</b>
          <span className={s.muted}>There is no browsing of private chats. Each read is written to the audit log with your name, the purpose and the reference.</span>
          <form className={s.card} onSubmit={async (e) => {
            e.preventDefault();
            try {
              setTranscript(await connectApi(`admin/conversations/${access.conversationId.trim()}/access`, "POST", { purpose: access.purpose, reference: access.reference, justification: access.justification }));
            } catch (x) {
              setMsg(connectErrorText(x));
            }
          }}>
            <label className={s.field}>Conversation id<input className={s.input} required value={access.conversationId} onChange={(e) => setAccess({ ...access, conversationId: e.target.value })} /></label>
            <label className={s.field}>Purpose
              <select className={s.input} value={access.purpose} onChange={(e) => setAccess({ ...access, purpose: e.target.value })}>
                <option value="SUPPORT_TICKET">Support ticket</option><option value="ABUSE_REPORT">Abuse report</option><option value="LEGAL_REQUEST">Legal request</option><option value="SAFETY">Safety</option>
              </select>
            </label>
            <label className={s.field}>Reference (ticket or report number)<input className={s.input} required value={access.reference} onChange={(e) => setAccess({ ...access, reference: e.target.value })} /></label>
            <label className={s.field}>Why you need to read it<input className={s.input} required minLength={1} value={access.justification} onChange={(e) => setAccess({ ...access, justification: e.target.value })} /></label>
            <button className={`${s.btn} ${s.small}`}>Open and log access</button>
          </form>
          {transcript && (
            <div className={s.card}>
              <b>Transcript (access logged)</b>
              {transcript.messages.map((m: any) => <div key={m.seq} className={s.muted}><b>{m.senderKind}{m.aiGenerated ? " (AI)" : ""}</b> · {whenLabel(m.createdAt)}: {m.body ?? `(${String(m.kind).toLowerCase()})`}</div>)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
