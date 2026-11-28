"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONNECT_LANGUAGES, CONNECT_TEMPLATES, formatPaise, type ConnectMessageDto } from "@barbercue/shared";
import { connectApi, connectErrorText, connectUpload, dayLabel, mediaUrl, msgTime, useConversation, useOnline, whenLabel, type ConnectDetail } from "../../lib/connect";
import s from "./connect.module.css";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🙏", "😮"];
const EMOJI_PICK = ["🙂", "👍", "🙏", "😊", "😂", "❤️", "✂️", "💈", "⏰", "📍"];

interface ActionDto {
  id: string;
  kind: string;
  label: string;
  status: string;
  requestedBy: string;
  payload: Record<string, unknown>;
  resultNote: string | null;
  expiresAt: string;
}
interface QuoteVersion {
  version: number;
  items: { name: string; quantity: number; unitPaise: number; durationMinutes: number; description?: string }[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  durationMinutes: number;
  validUntil: string;
  terms: string | null;
}
interface QuoteDto {
  id: string;
  title: string;
  status: string;
  currentVersion: number;
  acceptedVersion: number | null;
  versions: QuoteVersion[];
}
interface Complaint {
  id: string;
  ticketNumber: number | null;
  status: string;
  resolutionDueAt: string | null;
  resolution: string | null;
}
interface LocationDto {
  id: string;
  from: string;
  mine: boolean;
  lat: number;
  lng: number;
  expiresAt: string;
}

/**
 * The conversation view shared by the customer Messages page and the salon inbox. Rendering is
 * text-only (React escapes everything); links are never auto-activated from message text.
 */
export function ChatThread({
  conversationId,
  side,
  onBack,
  draft,
  onDraftUsed,
  savedReplies,
  headerExtra,
}: {
  conversationId: string;
  side: "CUSTOMER" | "SALON";
  onBack?: () => void;
  draft?: { text: string; fromSuggestionId?: string } | null;
  onDraftUsed?: () => void;
  savedReplies?: { id: string; title: string; body: string }[];
  headerExtra?: ReactNode;
}) {
  const c = useConversation(conversationId);
  const online = useOnline();
  const [text, setText] = useState("");
  const [fromSuggestion, setFromSuggestion] = useState<string | undefined>();
  const [replyTo, setReplyTo] = useState<ConnectMessageDto | null>(null);
  const [editing, setEditing] = useState<ConnectMessageDto | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [actions, setActions] = useState<ActionDto[]>([]);
  const [quotes, setQuotes] = useState<QuoteDto[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [locations, setLocations] = useState<LocationDto[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [lang, setLang] = useState("en");
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const d = c.detail;

  // An AI/saved draft handed in by the inbox fills the composer once (adjusting state during render).
  const [seenDraft, setSeenDraft] = useState(draft);
  if (draft !== seenDraft) {
    setSeenDraft(draft);
    if (draft?.text) {
      setText(draft.text);
      setFromSuggestion(draft.fromSuggestionId ?? "");
    }
  }
  useEffect(() => {
    if (draft?.text) onDraftUsed?.();
  }, [draft, onDraftUsed]);

  // Cards are fetched from their own authorised endpoints, refreshed whenever the thread changes.
  const lastSeq = c.messages.length ? c.messages[c.messages.length - 1].seq : 0;
  useEffect(() => {
    if (!d) return;
    void connectApi<ActionDto[]>(`conversations/${conversationId}/actions`).then(setActions).catch(() => undefined);
    void connectApi<QuoteDto[]>(`conversations/${conversationId}/quotations`).then(setQuotes).catch(() => setQuotes([]));
    void connectApi<Complaint[]>(`conversations/${conversationId}/complaints`).then(setComplaints).catch(() => undefined);
    if (d.flags.location) void connectApi<LocationDto[]>(`conversations/${conversationId}/location`).then(setLocations).catch(() => undefined);
  }, [conversationId, d, lastSeq]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastSeq, c.pending.length]);

  const readOnly = d?.lifecycle.status === "READ_ONLY";
  const blocked = d ? (side === "CUSTOMER" ? d.blockedByMe || d.blockedByOther : d.blockedByOther) : false;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setBanner(null);
    try {
      await fn();
      if (ok) setBanner(ok);
      c.refresh();
    } catch (e) {
      setBanner(connectErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      await run(() => connectApi(`conversations/${conversationId}/messages/${editing.id}`, "PUT", { body }));
      setEditing(null);
      setText("");
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      await c.send({ body, replyToId: replyTo?.id });
      setText("");
      setReplyTo(null);
      setFromSuggestion(undefined);
    } catch (e) {
      setBanner(connectErrorText(e));
      // A colleague replied meanwhile: show it before they send theirs.
      c.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function attach(file: File) {
    await run(async () => {
      const up = await connectUpload(conversationId, file, file.name);
      await c.send({ attachmentIds: [up.id], body: text.trim() || undefined, replyToId: replyTo?.id });
      setText("");
      setReplyTo(null);
    });
  }

  async function toggleRecord() {
    if (recording) {
      recording.stop();
      return;
    }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setBanner("Voice messages are not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size > 0) void attach(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }));
      };
      rec.start();
      setRecording(rec);
      setTimeout(() => rec.state === "recording" && rec.stop(), 120_000);
    } catch {
      setBanner("Microphone permission was not given.");
    }
  }

  async function translate(m: ConnectMessageDto) {
    try {
      const r = await connectApi<{ text: string | null; available: boolean; note: string | null }>(`conversations/${conversationId}/messages/${m.id}/translate`, "POST", { target: lang });
      if (r.text) setTranslations((t) => ({ ...t, [m.id]: r.text! }));
      else setBanner(r.note ?? "Translation is not available.");
    } catch (e) {
      setBanner(connectErrorText(e));
    }
  }

  async function shareLocation() {
    if (!navigator.geolocation) return setBanner("Location is not available on this device.");
    if (!window.confirm("Share your live location with this booking chat for 30 minutes? Only the people in this chat can see it, and you can stop at any time.")) return;
    navigator.geolocation.getCurrentPosition(
      (p) => void run(() => connectApi(`conversations/${conversationId}/location`, "POST", { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), minutes: 30, consent: true }), "Location shared for 30 minutes."),
      () => setBanner("Location permission was not given."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const grouped = useMemo(() => {
    const out: { day: string; items: ConnectMessageDto[] }[] = [];
    for (const m of c.messages) {
      const day = dayLabel(m.createdAt);
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(m);
    }
    return out;
  }, [c.messages]);

  if (!d && c.error) return <div className={s.thread}><p className={s.bannerError}>{c.error}</p></div>;
  if (!d) return <div className={s.thread} aria-busy="true"><div className={s.panelBody}><div className={s.skeleton} /><div className={s.skeleton} /></div></div>;

  const openComplaint = complaints.find((x) => !["RESOLVED", "CLOSED"].includes(x.status));
  const presence = d.presence.online ? "Online" : d.presence.lastActiveAt ? `Last active ${whenLabel(d.presence.lastActiveAt)}` : null;

  return (
    <section className={s.thread} aria-label="Conversation">
      <header className={s.threadHead}>
        {onBack && <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Back to conversations">←</button>}
        <div className={s.grow}>
          <div className={s.itemTitle}>{side === "SALON" ? (d.title ?? "Customer") : (d.card?.salonName ?? "Salon")}</div>
          <div className={s.muted}>{c.typing ? "typing…" : presence ?? (d.card ? `${d.card.reference} · ${d.card.statusLabel}` : "")}</div>
        </div>
        {headerExtra}
        <div style={{ position: "relative" }}>
          <button type="button" className={s.iconBtn} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)} aria-label="Conversation options">⋮</button>
          {menu && (
            <div role="menu" className={s.card} style={{ position: "absolute", right: 0, top: 48, zIndex: 20, width: 230 }}>
              <button role="menuitem" className={s.ghost} onClick={() => void run(() => connectApi(`conversations/${conversationId}/prefs`, "PUT", { muted: !d.muted }), d.muted ? "Notifications on" : "Muted")}>{d.muted ? "Unmute" : "Mute notifications"}</button>
              <button role="menuitem" className={s.ghost} onClick={() => void run(() => connectApi(`conversations/${conversationId}/prefs`, "PUT", { archived: !d.archived }), d.archived ? "Moved to inbox" : "Archived")}>{d.archived ? "Unarchive" : "Archive"}</button>
              {(side === "CUSTOMER" || d.canAssign) && <button role="menuitem" className={s.ghost} onClick={() => window.confirm(d.blockedByMe ? "Unblock?" : "Block new messages in this conversation?") && void run(() => connectApi(`conversations/${conversationId}/prefs`, "PUT", { blocked: !d.blockedByMe }))}>{d.blockedByMe ? "Unblock" : "Block"}</button>}
              <button role="menuitem" className={s.ghost} onClick={() => { const reason = window.prompt("Report this conversation. Reason: SPAM, ABUSE, HARASSMENT, FRAUD, INAPPROPRIATE or OTHER", "ABUSE")?.toUpperCase(); if (reason) void run(() => connectApi(`conversations/${conversationId}/report`, "POST", { reason: ["SPAM", "ABUSE", "HARASSMENT", "FRAUD", "INAPPROPRIATE"].includes(reason) ? reason : "OTHER" }), "Reported. FastQue will review it."); }}>Report</button>
              {side === "CUSTOMER" && !openComplaint && <button role="menuitem" className={s.ghost} onClick={() => { const details = window.prompt("Tell us what went wrong. A FastQue support ticket will be created."); if (details?.trim()) void run(() => connectApi(`conversations/${conversationId}/complaints`, "POST", { category: "OTHER", details: details.trim() }), "Support ticket created."); }}>Report a problem</button>}
              {d.flags.location && !readOnly && <button role="menuitem" className={s.ghost} onClick={() => void shareLocation()}>Share live location</button>}
              {d.flags.translation && (
                <label className={s.field}>Translate to
                  <select className={s.input} value={lang} onChange={(e) => setLang(e.target.value)}>
                    {CONNECT_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      </header>

      {d.card && <BookingCard card={d.card} />}
      {!online && <p className={s.banner} role="status">You are offline. Messages you type will be sent when you reconnect.</p>}
      {readOnly && <p className={s.banner}>{d.lifecycle.reason ?? "This conversation is read-only."}</p>}
      {blocked && !readOnly && <p className={s.banner}>{d.blockedByMe ? "You blocked this conversation." : "Messages are blocked in this conversation."}</p>}
      {openComplaint && <p className={s.banner}>Support ticket #{openComplaint.ticketNumber} · {openComplaint.status.replace(/_/g, " ").toLowerCase()}{openComplaint.resolutionDueAt ? ` · target ${whenLabel(openComplaint.resolutionDueAt)}` : ""}</p>}
      {banner && <p className={s.bannerError} role="alert">{banner}</p>}

      <div className={s.msgs} aria-live="polite">
        {c.hasMore && <button type="button" className={`${s.ghost} ${s.small}`} style={{ alignSelf: "center" }} onClick={() => void c.loadOlder()}>Load earlier messages</button>}
        {grouped.map((g) => (
          <div key={g.day} style={{ display: "contents" }}>
            <span className={s.day}>{g.day}</span>
            {g.items.map((m) => (
              <Message
                key={m.id}
                m={m}
                side={side}
                conversationId={conversationId}
                translated={translations[m.id]}
                canTranslate={d.flags.translation && !!m.body}
                action={m.meta?.actionId ? actions.find((a) => a.id === m.meta!.actionId) : undefined}
                quote={m.meta?.quotationId ? quotes.find((q) => q.id === m.meta!.quotationId) : undefined}
                location={m.kind === "LOCATION" ? locations[0] : undefined}
                readOnly={readOnly}
                onReply={() => setReplyTo(m)}
                onEdit={() => { setEditing(m); setText(m.body ?? ""); }}
                onTranslate={() => void translate(m)}
                run={run}
                actionsEnabled={d.flags.actions}
              />
            ))}
          </div>
        ))}
        {c.pending.map((p) => (
          <div key={p.clientMessageId} className={`${s.bubble} ${s.mine}`}>
            <div className={s.body}>{p.body}</div>
            <div className={s.meta}>
              {p.failed ? <>Not sent: {p.failed} <button className={s.tool} onClick={() => void c.flush()}>Retry</button><button className={s.tool} onClick={() => c.discardPending(p.clientMessageId)}>Discard</button></> : "Waiting to send…"}
            </div>
          </div>
        ))}
        {!c.messages.length && <div className={s.empty}>No messages yet.</div>}
        <div ref={endRef} />
      </div>
      <div className={s.typing}>{c.typing ? (side === "CUSTOMER" ? "The salon is typing…" : "The customer is typing…") : d.replyingNow ? `${d.replyingNow.name} is replying…` : ""}</div>

      {!readOnly && !blocked && (
        <>
          {side === "CUSTOMER" && (
            <div className={s.chips} aria-label="Quick messages">
              {CONNECT_TEMPLATES.map((t) => (
                <button key={t.key} type="button" className={s.chip} disabled={busy} onClick={() => void run(() => c.send({ templateKey: t.key }))}>{t.text}</button>
              ))}
            </div>
          )}
          {side === "SALON" && !!savedReplies?.length && (
            <div className={s.chips} aria-label="Saved replies">
              {savedReplies.map((r) => <button key={r.id} type="button" className={s.chip} onClick={() => setText(r.body)}>{r.title}</button>)}
            </div>
          )}
          {(replyTo || editing) && (
            <div className={s.between} style={{ padding: "4px 12px" }}>
              <span className={s.quote}>{editing ? "Editing message" : `Replying to: ${replyTo?.body?.slice(0, 80) ?? "attachment"}`}</span>
              <button className={s.tool} onClick={() => { setReplyTo(null); setEditing(null); setText(""); }}>Cancel</button>
            </div>
          )}
          {fromSuggestion !== undefined && <p className={s.muted} style={{ padding: "0 12px" }}>Suggested draft: review and edit before sending.</p>}
          {showEmoji && <div className={s.chips}>{EMOJI_PICK.map((e) => <button key={e} type="button" className={s.chip} onClick={() => setText((t) => t + e)}>{e}</button>)}</div>}
          <form className={s.composer} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <button type="button" className={s.iconBtn} aria-label="Emoji" onClick={() => setShowEmoji((x) => !x)}>☺</button>
            <button type="button" className={s.iconBtn} aria-label="Attach a photo or PDF" disabled={busy} onClick={() => fileRef.current?.click()}>📎</button>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attach(f); }} />
            <label className={s.srOnly} htmlFor={`msg-${conversationId}`}>Message</label>
            <textarea
              id={`msg-${conversationId}`}
              className={s.textarea}
              rows={1}
              value={text}
              maxLength={2000}
              placeholder="Type a message"
              onChange={(e) => { setText(e.target.value); c.notifyTyping(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            />
            {text.trim() ? (
              <button type="submit" className={s.sendBtn} disabled={busy} aria-label="Send">➤</button>
            ) : (
              <button type="button" className={recording ? s.sendBtn : s.iconBtn} onClick={() => void toggleRecord()} aria-label={recording ? "Stop and send voice message" : "Record a voice message"}>{recording ? "■" : "🎤"}</button>
            )}
          </form>
        </>
      )}
    </section>
  );
}

export function BookingCard({ card }: { card: NonNullable<ConnectDetail["card"]> }) {
  return (
    <div className={s.bookingCard} aria-label="Booking details">
      <div className={s.between}>
        <b>{card.salonName}</b>
        <span className={`${s.badge} ${["CANCELLED", "NO_SHOW", "EXPIRED"].includes(card.status) ? s.urgent : s.ok}`}>{card.statusLabel}</span>
      </div>
      <div className={s.kv}>
        <div><span>Booking</span><b>{card.reference}</b></div>
        {card.startsAt && <div><span>{card.kind === "LIVE_QUEUE" ? "Joined" : "Time"}</span><b>{whenLabel(card.startsAt)}</b></div>}
        {card.stylist && <div><span>{card.kind === "HOME_SERVICE" ? "Professional" : "Stylist"}</span><b>{card.stylist}</b></div>}
        {card.queuePosition != null && <div><span>Queue position</span><b>#{card.queuePosition}</b></div>}
        {card.estimatedWaitMinutes != null && <div><span>{card.kind === "HOME_SERVICE" ? "Arrives in about" : "Estimated wait"}</span><b>{card.estimatedWaitMinutes} min</b></div>}
        {card.durationMinutes != null && <div><span>Duration</span><b>{card.durationMinutes} min</b></div>}
        {card.totalPaise != null && <div><span>Total</span><b>{formatPaise(card.totalPaise)}</b></div>}
        {card.paymentStatus && <div><span>Payment</span><b>{card.paymentStatus === "PAY_AT_SALON" ? "Pay at salon" : card.paymentStatus.replace(/_/g, " ").toLowerCase()}</b></div>}
      </div>
      {!!card.services.length && <div className={s.muted}>{card.services.map((x) => x.name).join(" · ")}</div>}
    </div>
  );
}

function Message({
  m, side, conversationId, translated, canTranslate, action, quote, location, readOnly, onReply, onEdit, onTranslate, run, actionsEnabled,
}: {
  m: ConnectMessageDto;
  side: "CUSTOMER" | "SALON";
  conversationId: string;
  translated?: string;
  canTranslate: boolean;
  action?: ActionDto;
  quote?: QuoteDto;
  location?: LocationDto;
  readOnly: boolean;
  onReply: () => void;
  onEdit: () => void;
  onTranslate: () => void;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  actionsEnabled: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const isSystem = m.sender === "SYSTEM";
  const cls = isSystem ? s.system : m.sender === "AI" ? s.ai : m.mine ? s.mine : s.theirs;
  const editable = m.mine && m.kind === "TEXT" && !m.deleted && renderedAt - new Date(m.createdAt).getTime() < 15 * 60_000;
  const suggest = (m.meta?.suggestActions as string[] | undefined) ?? [];

  if (action) return <ActionCard a={action} side={side} conversationId={conversationId} run={run} readOnly={readOnly} />;
  if (quote) return <QuoteCard q={quote} side={side} conversationId={conversationId} run={run} />;

  return (
    <div className={`${s.bubble} ${cls}`}>
      {!isSystem && !m.mine && m.senderName && <span className={s.sender}>{m.sender === "AI" ? "🤖 FastQue Connect AI · automatic reply" : m.senderName}</span>}
      {m.replyTo && <div className={s.quote}>{m.replyTo.body ?? "Deleted message"}</div>}
      {m.attachments.map((a) =>
        a.mimeType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, expiring private media URL
          <a key={a.id} href={mediaUrl(a.url)} target="_blank" rel="noreferrer noopener"><img className={s.image} src={mediaUrl(a.url)} alt={a.fileName ?? "Photo"} loading="lazy" /></a>
        ) : a.mimeType.startsWith("audio/") ? (
          <audio key={a.id} className={s.audio} controls preload="none" src={mediaUrl(a.url)} aria-label="Voice message" />
        ) : (
          <a key={a.id} className={`${s.ghost} ${s.small}`} href={mediaUrl(a.url)} target="_blank" rel="noreferrer noopener">📄 {a.fileName ?? "Document"} ({Math.ceil(a.sizeBytes / 1024)} KB)</a>
        ),
      )}
      {m.deleted ? <em className={s.muted}>This message was deleted.</em> : m.body && <div className={s.body}>{translated && !showOriginal ? translated : m.body}</div>}
      {translated && <button className={s.tool} onClick={() => setShowOriginal((x) => !x)}>{showOriginal ? "Show translation" : "View original"}</button>}
      {location && <a className={`${s.ghost} ${s.small}`} href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noreferrer noopener">📍 Open shared location (until {msgTime(location.expiresAt)})</a>}
      {location?.mine && <button className={s.tool} onClick={() => void run(() => connectApi(`conversations/${conversationId}/location`, "DELETE"), "Location sharing stopped.")}>Stop sharing</button>}
      {side === "CUSTOMER" && actionsEnabled && !readOnly && !!suggest.length && (
        <div className={s.row}>
          {suggest.map((k) => (
            <button key={k} className={`${s.btn} ${s.small}`} onClick={() => {
              const body: Record<string, unknown> = { kind: k };
              if (k === "LATE_ARRIVAL") {
                const v = Number(window.prompt("About how many minutes late?", String((m.meta?.delayMinutes as number | null) ?? 10)));
                if (!v) return;
                body.delayMinutes = Math.min(240, Math.max(1, Math.round(v)));
              }
              void run(() => connectApi(`conversations/${conversationId}/actions`, "POST", body));
            }}>{k === "LATE_ARRIVAL" ? "Tell the salon I'm late" : k === "RESCHEDULE" ? "See other times" : k === "CANCEL" ? "Cancel booking" : "Ask to add a service"}</button>
          ))}
        </div>
      )}
      {!!m.reactions.length && (
        <div className={s.reactions}>
          {m.reactions.map((r) => <button key={r.emoji} className={s.reaction} aria-pressed={r.mine} onClick={() => void run(() => connectApi(`conversations/${conversationId}/messages/${m.id}/reactions`, "POST", { emoji: r.emoji }))}>{r.emoji} {r.count}</button>)}
        </div>
      )}
      <div className={s.meta}>
        {!isSystem && !m.deleted && !readOnly && (
          <span className={s.msgTools}>
            <button className={s.tool} onClick={onReply} aria-label="Reply">↩</button>
            {QUICK_EMOJI.slice(0, 2).map((e) => <button key={e} className={s.tool} onClick={() => void run(() => connectApi(`conversations/${conversationId}/messages/${m.id}/reactions`, "POST", { emoji: e }))} aria-label={`React ${e}`}>{e}</button>)}
            {canTranslate && !m.mine && <button className={s.tool} onClick={onTranslate}>Translate</button>}
            {editable && <button className={s.tool} onClick={onEdit}>Edit</button>}
            {m.mine && <button className={s.tool} onClick={() => window.confirm("Delete this message for everyone?") && void run(() => connectApi(`conversations/${conversationId}/messages/${m.id}`, "DELETE"))}>Delete</button>}
          </span>
        )}
        {m.edited && <span>edited</span>}
        {side === "SALON" && m.intent && m.intent !== "GENERAL" && <span className={s.badge}>{m.intent.replace(/_/g, " ").toLowerCase()}</span>}
        <time dateTime={m.createdAt}>{msgTime(m.createdAt)}</time>
        {m.status && <span aria-label={m.status}>{m.status === "read" ? "✓✓ Read" : m.status === "delivered" ? "✓✓" : "✓"}</span>}
      </div>
    </div>
  );
}

function ActionCard({ a, side, conversationId, run, readOnly }: { a: ActionDto; side: "CUSTOMER" | "SALON"; conversationId: string; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; readOnly: boolean }) {
  const p = a.payload;
  const open = a.status === "AWAITING_CUSTOMER" || a.status === "AWAITING_SALON";
  const myTurn = (a.status === "AWAITING_CUSTOMER" && side === "CUSTOMER") || (a.status === "AWAITING_SALON" && side === "SALON");
  const decide = (decision: string, extra: object = {}) => run(() => connectApi(`conversations/${conversationId}/actions/${a.id}/decision`, "POST", { decision, ...extra }));
  const options = (p.options as string[] | undefined) ?? [];
  const labels = (p.optionLabels as string[] | undefined) ?? options.map(whenLabel);
  return (
    <div className={s.actionCard} role="group" aria-label={a.label}>
      <div className={s.between}><b>{a.label}</b><span className={`${s.badge} ${open ? s.high : a.status === "APPLIED" || a.status === "ACKNOWLEDGED" ? s.ok : s.urgent}`}>{a.status.replace(/_/g, " ").toLowerCase()}</span></div>
      {a.kind === "LATE_ARRIVAL" && <span className={s.muted}>About {String(p.delayMinutes)} min late. {String(p.fairness ?? "")}</span>}
      {a.kind === "CANCEL" && open && side === "CUSTOMER" && <span className={s.muted}>Please confirm. Cancellation rules of the salon apply{p.policy ? ` (free until ${(p.policy as { freeCancellationWindowMinutes?: number }).freeCancellationWindowMinutes ?? "?"} min before)` : ""}.</span>}
      {a.kind === "RESCHEDULE" && typeof p.chosen === "string" && <span className={s.muted}>New time chosen: {whenLabel(p.chosen)}</span>}
      {a.kind === "RESCHEDULE" && open && a.status === "AWAITING_CUSTOMER" && (
        options.length ? (
          side === "CUSTOMER" ? <div className={s.row}>{options.map((o, i) => <button key={o} className={`${s.ghost} ${s.small}`} onClick={() => void decide("APPROVE", { optionSlotStart: o })}>{labels[i]}</button>)}</div>
            : <span className={s.muted}>Waiting for the customer to pick one of {options.length} available times.</span>
        ) : <span className={s.muted}>No open times that day. Ask in chat for another day.</span>
      )}
      {a.resultNote && <span className={s.muted}>{a.resultNote}</span>}
      {open && !readOnly && (
        <div className={s.row}>
          {myTurn && !(a.kind === "RESCHEDULE" && a.status === "AWAITING_CUSTOMER") && <button className={`${s.btn} ${s.small}`} onClick={() => void decide("APPROVE")}>{a.kind === "CANCEL" ? "Yes, cancel my booking" : "Confirm"}</button>}
          {myTurn && <button className={`${s.ghost} ${s.small}`} onClick={() => void decide("DECLINE")}>Decline</button>}
          {!myTurn && a.requestedBy === side && <button className={`${s.ghost} ${s.small}`} onClick={() => void decide("CANCEL")}>Withdraw</button>}
          {!myTurn && <span className={s.muted}>{a.status === "AWAITING_SALON" ? "Waiting for the salon." : "Waiting for the customer."}</span>}
        </div>
      )}
    </div>
  );
}

function QuoteCard({ q, side, conversationId, run }: { q: QuoteDto; side: "CUSTOMER" | "SALON"; conversationId: string; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const v = q.versions.find((x) => x.version === q.currentVersion) ?? q.versions[0];
  const decide = (decision: string) => run(() => connectApi(`conversations/${conversationId}/quotations/${q.id}/decision`, "POST", { decision, version: q.currentVersion, note: decision === "REQUEST_CHANGES" ? (window.prompt("What would you like changed?") ?? undefined) : undefined }));
  return (
    <div className={s.actionCard} role="group" aria-label={`Quotation ${q.title}`}>
      <div className={s.between}><b>🧾 {q.title}</b><span className={`${s.badge} ${q.status === "ACCEPTED" ? s.ok : q.status === "SENT" ? s.high : ""}`}>{q.status.replace(/_/g, " ").toLowerCase()} · v{q.currentVersion}</span></div>
      <div className={s.lines}>
        {v.items.map((i, k) => <div key={k}><span>{i.name}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span><span>{formatPaise(i.unitPaise * i.quantity)}</span></div>)}
        {v.discountPaise > 0 && <div><span>Discount</span><span>− {formatPaise(v.discountPaise)}</span></div>}
        {v.taxPaise > 0 && <div><span>Tax</span><span>{formatPaise(v.taxPaise)}</span></div>}
        <div className={s.total}><span>Total</span><span>{formatPaise(v.totalPaise)}</span></div>
      </div>
      <span className={s.muted}>About {v.durationMinutes} min · valid until {whenLabel(v.validUntil)}</span>
      {v.terms && <span className={s.muted}>{v.terms}</span>}
      {side === "CUSTOMER" && q.status === "SENT" && (
        <div className={s.row}>
          <button className={`${s.btn} ${s.small}`} onClick={() => window.confirm(`Accept ${q.title} for ${formatPaise(v.totalPaise)}?`) && void decide("ACCEPT")}>Accept</button>
          <button className={`${s.ghost} ${s.small}`} onClick={() => void decide("REQUEST_CHANGES")}>Ask for changes</button>
          <button className={`${s.ghost} ${s.small}`} onClick={() => void decide("DECLINE")}>Decline</button>
        </div>
      )}
      {side === "SALON" && ["SENT", "CHANGES_REQUESTED"].includes(q.status) && <button className={`${s.ghost} ${s.small}`} onClick={() => void decide("WITHDRAW")}>Withdraw</button>}
    </div>
  );
}
