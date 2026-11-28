"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CONNECT_INTENT_LABEL, CONNECT_LOW_RISK_INTENTS, formatPaise, type ConnectIntent } from "@barbercue/shared";
import { connectApi, connectErrorText, connectLinksEnabled, whenLabel, type ConnectConversationSummaryDto, type ConnectDetail } from "../../lib/connect";
import { getRealtimeSocket } from "../../lib/realtime";
import { ChatThread } from "./ChatThread";
import s from "./connect.module.css";

const FOLDERS: [string, string][] = [
  ["all", "All"], ["awaiting_salon", "Unread / awaiting you"], ["new", "New booking chats"], ["upcoming", "Upcoming"], ["queue", "Live queue"],
  ["home", "Home service"], ["awaiting_customer", "Awaiting customer"], ["urgent", "Urgent"], ["ai", "AI-handled"],
  ["complaints", "Complaints"], ["completed", "Completed"], ["mine", "Assigned to me"], ["archived", "Archived"],
];

interface InboxRes {
  role: string;
  conversations: ConnectConversationSummaryDto[];
  nextCursor: string | null;
  counts: { all: number; awaitingSalon: number; urgent: number; complaints: number; ai: number };
}

/** The owner dashboard's FastQue Connect tab. `provider` = an independent home professional's inbox. */
export function OwnerConnect({ salonId, provider = false }: { salonId?: string; provider?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "inbox";
  const base = provider ? "/home-pro/messages" : `/dashboard/salons/${salonId}/connect`;
  if (!connectLinksEnabled()) return <div className={`${s.root} ${s.darkDefault} ${s.page}`}><h1 className={s.h1}>FastQue Connect</h1><p className={s.muted}>FastQue Connect is not switched on yet.</p></div>;
  return (
    <div className={`${s.root} ${s.darkDefault} ${s.page}`}>
      <div className={s.between}>
        <h1 className={s.h1}>FastQue Connect</h1>
        {!provider && (
          <nav className={s.tabs} aria-label="Connect sections">
            {[["inbox", "Inbox"], ["settings", "Settings"], ["analytics", "Analytics"]].map(([id, label]) => (
              <button key={id} type="button" className={s.tab} aria-pressed={tab === id} onClick={() => router.replace(`${base}?tab=${id}`)}>{label}</button>
            ))}
          </nav>
        )}
      </div>
      {tab === "settings" && salonId ? <Settings salonId={salonId} /> : tab === "analytics" && salonId ? <Analytics salonId={salonId} /> : <Inbox salonId={salonId} provider={provider} base={base} />}
    </div>
  );
}

function Inbox({ salonId, provider, base }: { salonId?: string; provider: boolean; base: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("c");
  const [folder, setFolder] = useState("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<InboxRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; body: string }[]>([]);
  const [draft, setDraft] = useState<{ text: string; fromSuggestionId?: string } | null>(null);

  const path = provider ? "provider/inbox" : `salons/${salonId}/inbox`;
  const load = useCallback(() => {
    const qs = new URLSearchParams({ folder });
    if (q) qs.set("q", q);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    connectApi<InboxRes>(`${path}?${qs}`).then((r) => { setData(r); setError(null); }).catch((e) => setError(connectErrorText(e)));
  }, [path, folder, q, from, to]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    const sock = getRealtimeSocket();
    sock.on("connect.message", load);
    sock.on("connect.updated", load);
    return () => {
      clearTimeout(t);
      sock.off("connect.message", load);
      sock.off("connect.updated", load);
    };
  }, [load, q]);
  useEffect(() => {
    if (salonId) void connectApi<{ id: string; title: string; body: string }[]>(`salons/${salonId}/saved-replies`).then(setSaved).catch(() => undefined);
  }, [salonId]);

  const open = (id: string | null) => router.replace(id ? `${base}?c=${id}` : base, { scroll: false });
  const countFor = (f: string) => (data ? ({ all: data.counts.all, awaiting_salon: data.counts.awaitingSalon, urgent: data.counts.urgent, complaints: data.counts.complaints, ai: data.counts.ai } as Record<string, number>)[f] : undefined);

  return (
    <>
      {error && <p className={s.bannerError} role="alert">{error}</p>}
      <div className={s.inbox}>
        <nav className={`${s.panel} ${active ? s.hideOnPhone : ""}`} aria-label="Folders">
          <div className={s.folders}>
            {FOLDERS.map(([id, label]) => (
              <button key={id} type="button" className={s.folder} aria-pressed={folder === id} onClick={() => setFolder(id)}>
                <span>{label}</span>{countFor(id) !== undefined && <span className={s.count}>{countFor(id)}</span>}
              </button>
            ))}
          </div>
        </nav>
        <section className={`${s.panel} ${active ? s.hideOnPhone : ""}`} aria-label="Conversations">
          <div className={s.panelBody}>
            <input className={s.input} type="search" placeholder="Customer, booking ID (BK-…), token or tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <div className={s.row}>
              <label className={s.field} style={{ flex: 1 }}>From<input className={s.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className={s.field} style={{ flex: 1 }}>To<input className={s.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          </div>
          <div className={s.list}>
            {!data && <><div className={s.skeleton} /><div className={s.skeleton} /><div className={s.skeleton} /></>}
            {data?.conversations.length === 0 && <div className={s.empty}><p>No conversations here.</p><p className={s.muted}>Customers can message you once they book.</p></div>}
            {data?.conversations.map((c) => (
              <button key={c.id} type="button" className={s.item} aria-current={c.id === active} onClick={() => open(c.id)}>
                <span className={s.between}>
                  <span className={s.itemTitle}>{c.title}</span>
                  {c.awaiting === "SALON" && <span className={s.unread}>!</span>}
                </span>
                <span className={s.muted}>{c.subtitle}</span>
                <span className={s.itemPreview}>{c.lastMessage ?? ""}</span>
                <span className={s.row}>
                  {c.priority !== "NORMAL" && <span className={`${s.badge} ${c.priority === "URGENT" ? s.urgent : s.high}`}>{c.priority.toLowerCase()}</span>}
                  {c.hasOpenComplaint && <span className={`${s.badge} ${s.urgent}`}>complaint</span>}
                  {c.aiHandled && <span className={`${s.badge} ${s.aiBadge}`}>AI</span>}
                  {c.sentiment && c.sentiment !== "NEUTRAL" && <span className={s.badge} title="Advisory signal, not a verified fact">{c.sentiment.toLowerCase()}</span>}
                  {c.tags.map((t) => <span key={t} className={s.badge}>#{t}</span>)}
                  {c.lastMessageAt && <span className={s.muted} style={{ fontSize: "0.72rem" }}>{whenLabel(c.lastMessageAt)}</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
        {active ? (
          <ChatThread key={active} conversationId={active} side="SALON" onBack={() => open(null)} draft={draft} onDraftUsed={() => setDraft(null)} savedReplies={saved} />
        ) : (
          <div className={`${s.thread} ${s.hideOnPhone}`}><div className={s.empty}><p>Choose a conversation.</p></div></div>
        )}
        {active && <ContextPanel key={`ctx-${active}`} conversationId={active} onUseDraft={setDraft} />}
      </div>
    </>
  );
}

interface Suggestion {
  intent: ConnectIntent;
  intentLabel: string;
  confidence: number;
  escalate: string | null;
  drafts: { text: string; source: string }[];
  actions: string[];
  injectionFlagged: boolean;
  aiAvailable: boolean;
}

function ContextPanel({ conversationId, onUseDraft }: { conversationId: string; onUseDraft: (d: { text: string; fromSuggestionId?: string }) => void }) {
  const [d, setD] = useState<ConnectDetail | null>(null);
  const [notes, setNotes] = useState<{ id: string; body: string; at: string; author: string }[]>([]);
  const [note, setNote] = useState("");
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [history, setHistory] = useState<{ totalVisits: number; visits: { reference: string; at: string; status: string; services: string[]; totalPaise: number }[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const load = useCallback(() => {
    void connectApi<ConnectDetail>(`conversations/${conversationId}`).then(setD).catch(() => undefined);
    void connectApi<typeof notes>(`conversations/${conversationId}/notes`).then(setNotes).catch(() => undefined);
  }, [conversationId]);
  useEffect(() => {
    load();
    const sock = getRealtimeSocket();
    const h = (p: { conversationId: string }) => p.conversationId === conversationId && load();
    sock.on("connect.updated", h);
    sock.on("connect.message", h);
    return () => {
      sock.off("connect.updated", h);
      sock.off("connect.message", h);
    };
  }, [load, conversationId]);
  useEffect(() => {
    void connectApi<typeof history>(`conversations/${conversationId}/history`).then(setHistory).catch(() => setHistory(null));
  }, [conversationId]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      load();
    } catch (e) {
      setMsg(connectErrorText(e));
    }
  };
  if (!d) return <aside className={`${s.panel} ${s.hideOnPhone}`}><div className={s.panelBody}><div className={s.skeleton} /></div></aside>;

  return (
    <aside className={s.panel} aria-label="Conversation details">
      <div className={s.panelBody}>
        {msg && <p className={s.banner} role="status">{msg}</p>}
        {d.replyingNow && <p className={s.banner}>{d.replyingNow.name} is replying right now.</p>}
        {d.sentiment && d.sentiment !== "NEUTRAL" && <p className={s.muted}>Advisory sentiment: <b>{d.sentiment.toLowerCase()}</b>{d.sentimentReason ? ` · ${d.sentimentReason}` : ""}. This is a signal, not a verified fact.</p>}

        {d.flags.ai && (
          <section className={s.card} aria-label="AI suggestions">
            <div className={s.between}><b>Connect AI</b><button className={`${s.ghost} ${s.small}`} onClick={() => void act(async () => setSug(await connectApi<Suggestion>(`conversations/${conversationId}/suggestions`)))}>Suggest reply</button></div>
            {sug && (
              <>
                <span className={s.muted}>Detected: {sug.intentLabel} ({Math.round(sug.confidence * 100)}%){sug.injectionFlagged ? " · suspicious instructions ignored" : ""}</span>
                {sug.escalate && <span className={`${s.badge} ${s.urgent}`}>Needs a person: {sug.escalate.replace(/_/g, " ").toLowerCase()}</span>}
                {sug.drafts.map((x, i) => (
                  <div key={i} className={s.card}>
                    <span className={s.body}>{x.text}</span>
                    <div className={s.between}><span className={s.muted}>{x.source === "LLM" ? "AI draft (checked against your data)" : x.source === "RULES" ? "From your verified salon data" : "Template"}</span><button className={`${s.btn} ${s.small}`} onClick={() => onUseDraft({ text: x.text })}>Use</button></div>
                  </div>
                ))}
                {!sug.aiAvailable && <span className={s.muted}>No AI provider is configured; suggestions come from your salon data and templates.</span>}
              </>
            )}
            <button className={`${s.ghost} ${s.small}`} onClick={() => void act(async () => setSummary((await connectApi<{ summary: string }>(`conversations/${conversationId}/summary`, "POST")).summary))}>Summarise conversation</button>
            {(summary ?? d.summary) && <p className={s.muted}>{summary ?? d.summary}</p>}
          </section>
        )}

        <section className={s.card} aria-label="Handling">
          <b>Handling</b>
          {d.canAssign && (
            <label className={s.field}>Assigned to
              <select className={s.input} value={d.assignedToUserId ?? ""} onChange={(e) => void act(() => connectApi(`conversations/${conversationId}/assign`, "POST", { userId: e.target.value || null }), "Assignment saved")}>
                <option value="">Unassigned</option>
                {d.staff?.map((x) => <option key={x.userId} value={x.userId}>{x.name} ({x.role.toLowerCase()})</option>)}
              </select>
            </label>
          )}
          <label className={s.field}>Priority
            <select className={s.input} value={d.priority} onChange={(e) => void act(() => connectApi(`conversations/${conversationId}`, "PATCH", { priority: e.target.value }))}>
              <option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
            </select>
          </label>
          <label className={s.field}>Tags (comma separated)
            <input className={s.input} defaultValue={d.tags?.join(", ")} onBlur={(e) => void act(() => connectApi(`conversations/${conversationId}`, "PATCH", { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10) }))} />
          </label>
          <button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => connectApi(`conversations/${conversationId}`, "PATCH", { resolved: true }), "Marked resolved")}>Mark resolved</button>
          {d.flags.actions && d.card?.kind === "SALON_BOOKING" && <button className={`${s.ghost} ${s.small}`} onClick={() => void act(() => connectApi(`conversations/${conversationId}/actions`, "POST", { kind: "RESCHEDULE" }), "Available times sent to the customer")}>Offer other times</button>}
          {d.flags.quotations && (d.role === "OWNER" || d.role === "MANAGER") && <button className={`${s.ghost} ${s.small}`} onClick={() => setQuoteOpen((x) => !x)}>Send a quotation</button>}
          {quoteOpen && <QuoteForm conversationId={conversationId} onDone={() => { setQuoteOpen(false); setMsg("Quotation sent"); }} />}
        </section>

        <section className={s.card} aria-label="Internal notes">
          <b>Internal notes</b>
          <span className={s.muted}>Only your team sees these.</span>
          {notes.map((n) => <div key={n.id} className={s.muted}><b>{n.author}</b> · {whenLabel(n.at)}<br />{n.body}</div>)}
          <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) void act(async () => { setNotes(await connectApi(`conversations/${conversationId}/notes`, "POST", { body: note.trim() })); setNote(""); }); }} className={s.row}>
            <input className={s.input} style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" maxLength={2000} />
            <button className={`${s.btn} ${s.small}`}>Add</button>
          </form>
        </section>

        {history && (
          <section className={s.card} aria-label="Customer history">
            <b>Visits at your salon: {history.totalVisits} completed</b>
            {history.visits.slice(0, 5).map((v) => <span key={v.reference} className={s.muted}>{whenLabel(v.at)} · {v.services.join(", ")} · {formatPaise(v.totalPaise)} · {v.status.toLowerCase()}</span>)}
          </section>
        )}
      </div>
    </aside>
  );
}

function QuoteForm({ conversationId, onDone }: { conversationId: string; onDone: () => void }) {
  const [title, setTitle] = useState("Custom package");
  const [lines, setLines] = useState([{ name: "", quantity: 1, rupees: 0, durationMinutes: 30 }]);
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [terms, setTerms] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const subtotal = lines.reduce((n, l) => n + Math.round(l.rupees * 100) * l.quantity, 0);
  const total = subtotal - Math.min(discount * 100, subtotal) + Math.round(((subtotal - Math.min(discount * 100, subtotal)) * tax) / 100);
  return (
    <form className={s.card} onSubmit={async (e) => {
      e.preventDefault();
      setErr(null);
      try {
        await connectApi(`conversations/${conversationId}/quotations`, "POST", { title, items: lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), quantity: l.quantity, unitPaise: Math.round(l.rupees * 100), durationMinutes: l.durationMinutes })), discountPaise: Math.round(discount * 100), taxPercent: tax, validDays: 7, terms: terms.trim() || undefined });
        onDone();
      } catch (x) {
        setErr(connectErrorText(x));
      }
    }}>
      <label className={s.field}>Title<input className={s.input} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} /></label>
      {lines.map((l, i) => (
        <div key={i} className={s.row}>
          <input className={s.input} style={{ flex: 2 }} placeholder="Service" value={l.name} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label="Service name" />
          <input className={s.input} style={{ flex: 1 }} type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value) || 1 } : x)))} aria-label="Quantity" />
          <input className={s.input} style={{ flex: 1 }} type="number" min={0} step="1" value={l.rupees} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, rupees: Number(e.target.value) || 0 } : x)))} aria-label="Price in rupees" />
        </div>
      ))}
      <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => setLines([...lines, { name: "", quantity: 1, rupees: 0, durationMinutes: 30 }])}>Add line</button>
      <div className={s.row}>
        <label className={s.field} style={{ flex: 1 }}>Discount ₹<input className={s.input} type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></label>
        <label className={s.field} style={{ flex: 1 }}>Tax %<input className={s.input} type="number" min={0} max={28} value={tax} onChange={(e) => setTax(Number(e.target.value) || 0)} /></label>
      </div>
      <label className={s.field}>Terms<input className={s.input} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={1000} /></label>
      <span className={s.muted}>Total shown to the customer: {formatPaise(total)} (calculated again by the server).</span>
      {err && <span className={s.bannerError}>{err}</span>}
      <button className={`${s.btn} ${s.small}`}>Send quotation</button>
    </form>
  );
}

interface SettingsDto {
  aiMode: string;
  autoReplyIntents: string[];
  translationEnabled: boolean;
  followUpsEnabled: boolean;
  faq: { q: string; a: string }[];
  parkingInfo: string | null;
  directions: string | null;
  aftercare: string | null;
}

function Settings({ salonId }: { salonId: string }) {
  const [st, setSt] = useState<SettingsDto | null>(null);
  const [staff, setStaff] = useState<{ userId: string; name: string; connectRole: string | null }[] | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; body: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [newReply, setNewReply] = useState({ title: "", body: "" });
  useEffect(() => {
    void connectApi<SettingsDto>(`salons/${salonId}/settings`).then(setSt).catch((e) => setMsg(connectErrorText(e)));
    void connectApi<typeof staff>(`salons/${salonId}/staff`).then(setStaff).catch(() => setStaff(null));
    void connectApi<typeof saved>(`salons/${salonId}/saved-replies`).then(setSaved).catch(() => undefined);
  }, [salonId]);
  if (!st) return <div className={s.skeleton} />;
  const save = async (patch: Partial<SettingsDto>) => {
    try {
      setSt(await connectApi<SettingsDto>(`salons/${salonId}/settings`, "PUT", patch));
      setMsg("Saved");
    } catch (e) {
      setMsg(connectErrorText(e));
    }
  };
  return (
    <div className={s.stats} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))" }}>
      {msg && <p className={s.banner} role="status" style={{ gridColumn: "1 / -1" }}>{msg}</p>}
      <section className={s.card}>
        <h2 className={s.h2}>Connect AI</h2>
        <p className={s.muted}>AI only uses your services, prices, hours, offers, policies and the answers below. It never invents prices or availability, and every automatic reply is labelled as AI.</p>
        {[["OFF", "Off"], ["SUGGEST", "Suggest replies for my team to approve"], ["AUTO", "Answer simple questions automatically"]].map(([v, l]) => (
          <label key={v} className={s.row}><input type="radio" name="aiMode" checked={st.aiMode === v} onChange={() => void save({ aiMode: v })} /> {l}</label>
        ))}
        {st.aiMode === "AUTO" && (
          <fieldset className={s.card}>
            <legend className={s.muted}>Questions AI may answer by itself</legend>
            {CONNECT_LOW_RISK_INTENTS.map((i) => (
              <label key={i} className={s.row}><input type="checkbox" checked={st.autoReplyIntents.includes(i)} onChange={(e) => void save({ autoReplyIntents: e.target.checked ? [...st.autoReplyIntents, i] : st.autoReplyIntents.filter((x) => x !== i) })} /> {CONNECT_INTENT_LABEL[i]}</label>
            ))}
            <span className={s.muted}>Complaints, refunds, payments, custom prices and safety are always handed to a person.</span>
          </fieldset>
        )}
        <label className={s.row}><input type="checkbox" checked={st.translationEnabled} onChange={(e) => void save({ translationEnabled: e.target.checked })} /> Offer translation (needs an AI provider)</label>
        <label className={s.row}><input type="checkbox" checked={st.followUpsEnabled} onChange={(e) => void save({ followUpsEnabled: e.target.checked })} /> Thank-you, feedback and aftercare messages after a visit</label>
      </section>
      <section className={s.card}>
        <h2 className={s.h2}>Facts customers ask about</h2>
        <label className={s.field}>Parking<input className={s.input} defaultValue={st.parkingInfo ?? ""} onBlur={(e) => void save({ parkingInfo: e.target.value.trim() || null })} maxLength={500} /></label>
        <label className={s.field}>Directions<input className={s.input} defaultValue={st.directions ?? ""} onBlur={(e) => void save({ directions: e.target.value.trim() || null })} maxLength={500} /></label>
        <label className={s.field}>Aftercare<input className={s.input} defaultValue={st.aftercare ?? ""} onBlur={(e) => void save({ aftercare: e.target.value.trim() || null })} maxLength={800} /></label>
        <b>FAQ</b>
        {st.faq.map((f, i) => <div key={i} className={s.between}><span className={s.muted}><b>{f.q}</b><br />{f.a}</span><button className={s.tool} onClick={() => void save({ faq: st.faq.filter((_, k) => k !== i) })}>Remove</button></div>)}
        <form className={s.card} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const q = String(f.get("q") ?? "").trim(); const a = String(f.get("a") ?? "").trim(); if (q && a) { void save({ faq: [...st.faq, { q, a }] }); e.currentTarget.reset(); } }}>
          <input className={s.input} name="q" placeholder="Question" maxLength={200} />
          <input className={s.input} name="a" placeholder="Answer" maxLength={800} />
          <button className={`${s.btn} ${s.small}`}>Add FAQ</button>
        </form>
      </section>
      <section className={s.card}>
        <h2 className={s.h2}>Saved replies</h2>
        {saved.map((r) => <div key={r.id} className={s.between}><span className={s.muted}><b>{r.title}</b> · {r.body}</span><button className={s.tool} onClick={() => void connectApi<typeof saved>(`salons/${salonId}/saved-replies/${r.id}`, "DELETE").then(setSaved)}>Remove</button></div>)}
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); if (newReply.title && newReply.body) void connectApi<typeof saved>(`salons/${salonId}/saved-replies`, "POST", newReply).then((r) => { setSaved(r); setNewReply({ title: "", body: "" }); }).catch((x) => setMsg(connectErrorText(x))); }}>
          <input className={s.input} placeholder="Title" value={newReply.title} onChange={(e) => setNewReply({ ...newReply, title: e.target.value })} maxLength={80} />
          <input className={s.input} placeholder="Reply text" value={newReply.body} onChange={(e) => setNewReply({ ...newReply, body: e.target.value })} maxLength={1000} />
          <button className={`${s.btn} ${s.small}`}>Save</button>
        </form>
      </section>
      {staff && (
        <section className={s.card}>
          <h2 className={s.h2}>Who can answer chats</h2>
          <p className={s.muted}>Managers see and assign everything. Receptionists answer chats. Stylists only see chats assigned to them.</p>
          {staff.length === 0 && <span className={s.muted}>No staff yet.</span>}
          {staff.map((m) => (
            <label key={m.userId} className={s.between}><span>{m.name}</span>
              <select className={s.input} style={{ maxWidth: 180 }} value={m.connectRole ?? ""} onChange={(e) => void connectApi<typeof staff>(`salons/${salonId}/staff`, "PUT", { userId: m.userId, role: e.target.value || null }).then(setStaff).catch((x) => setMsg(connectErrorText(x)))}>
                <option value="">No access</option><option value="MANAGER">Manager</option><option value="RECEPTIONIST">Receptionist</option><option value="STYLIST">Stylist</option>
              </select>
            </label>
          ))}
        </section>
      )}
    </div>
  );
}

const secs = (n: number | null) => (n == null ? "No data yet" : n < 90 ? `${n}s` : n < 5400 ? `${Math.round(n / 60)} min` : `${Math.round(n / 3600)} h`);
const pct = (n: number | null) => (n == null ? "No data yet" : `${n}%`);

function Analytics({ salonId }: { salonId: string }) {
  const [period, setPeriod] = useState("week");
  const [a, setA] = useState<Record<string, any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    connectApi<Record<string, unknown>>(`salons/${salonId}/analytics?period=${period}`).then(setA).catch((e) => setErr(connectErrorText(e)));
  }, [salonId, period]);
  if (err) return <p className={s.bannerError}>{err}</p>;
  const tiles: [string, string | number][] = a
    ? [
        ["Conversations", a.totals.conversations], ["Active", a.totals.active], ["Awaiting your reply", a.totals.awaitingSalon], ["Unanswered messages", a.totals.unansweredMessages],
        ["First reply (avg)", secs(a.responsiveness.firstResponseAvgSeconds)], ["First reply (median)", secs(a.responsiveness.firstResponseMedianSeconds)], ["Resolution (avg)", secs(a.responsiveness.resolutionAvgSeconds)],
        ["AI auto-reply rate", pct(a.ai.autoReplyRatePct)], ["Hand-off to a person", pct(a.ai.escalationRatePct)], ["Booking change requests", a.bookings.modificationRequests],
        ["Cancellations prevented", pct(a.bookings.cancellationPreventionRatePct)], ["Rebookings from chat", a.bookings.rebookingsFromChat],
        ["Quotation acceptance", pct(a.revenue.quotationAcceptanceRatePct)], ["Extra service revenue", formatPaise(a.revenue.additionalServicePaise + a.revenue.acceptedQuotationPaise)],
        ["Average rating", a.satisfaction.averageRating ?? "No data yet"],
      ]
    : [];
  const maxHour = a ? Math.max(1, ...a.peakHours.map((h: { messages: number }) => h.messages)) : 1;
  return (
    <div className={s.page} style={{ padding: 0 }}>
      <div className={s.between}>
        <div className={s.tabs}>{["day", "week", "month"].map((p) => <button key={p} type="button" className={s.tab} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p === "day" ? "Today" : p === "week" ? "7 days" : "30 days"}</button>)}</div>
        <a className={`${s.ghost} ${s.small}`} href={`${(process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1").replace(/\/+$/, "")}/connect/salons/${salonId}/analytics.csv?period=${period}`} onClick={async (e) => {
          // The export needs the bearer token, so it is fetched rather than linked.
          e.preventDefault();
          const { apiFetchBlob } = await import("../../lib/api");
          const { blob } = await apiFetchBlob(`connect/salons/${salonId}/analytics.csv?period=${period}`);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "fastque-connect-analytics.csv";
          link.click();
          URL.revokeObjectURL(url);
        }}>Export CSV</a>
      </div>
      {!a ? <div className={s.skeleton} /> : (
        <>
          <div className={s.stats}>{tiles.map(([l, v]) => <div key={l} className={s.stat}><span className={s.muted}>{l}</span><span className={s.statValue}>{v}</span></div>)}</div>
          <section className={s.card}><b>Busiest hours (customer messages)</b>
            {a.peakHours.length ? <div className={s.bars} role="img" aria-label="Messages by hour">{Array.from({ length: 24 }, (_, h) => { const v = a.peakHours.find((x: { hour: number }) => x.hour === h)?.messages ?? 0; return <div key={h} className={s.bar} title={`${h}:00 · ${v}`} style={{ height: `${(v / maxHour) * 100}%` }} />; })}</div> : <span className={s.muted}>No data yet</span>}
          </section>
          <section className={s.card}><b>Top questions</b>{a.topQuestions.length ? a.topQuestions.map((q: { label: string; count: number }) => <div key={q.label} className={s.between}><span>{q.label}</span><b>{q.count}</b></div>) : <span className={s.muted}>No data yet</span>}</section>
          <section className={s.card}><b>Team replies</b>{a.staff.length ? <table className={s.table}><thead><tr><th>Person</th><th>Replies</th><th>Median first reply</th></tr></thead><tbody>{a.staff.map((x: { userId: string; name: string; replies: number; firstResponseMedianSeconds: number | null }) => <tr key={x.userId}><td>{x.name}</td><td>{x.replies}</td><td>{secs(x.firstResponseMedianSeconds)}</td></tr>)}</tbody></table> : <span className={s.muted}>No data yet</span>}</section>
          <section className={s.card}><b>How these are counted</b>{Object.entries(a.definitions as Record<string, string>).map(([k, v]) => <span key={k} className={s.muted}>{v}</span>)}<span className={s.muted}>Sentiment is an advisory signal from simple rules, not a verified fact.</span></section>
        </>
      )}
    </div>
  );
}
