"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { connectApi, connectErrorText, connectLinksEnabled, whenLabel, type ConnectConversationSummaryDto } from "../../lib/connect";
import { getRealtimeSocket } from "../../lib/realtime";
import { ChatThread } from "./ChatThread";
import s from "./connect.module.css";

interface Prefs {
  showOnline: boolean;
  showLastActive: boolean;
  notificationPreviews: boolean;
  preferredLanguage: string | null;
  promotionalMessages: boolean;
}

/** Customer dashboard → Messages. Mobile-first: list or thread on a phone, both side by side on desktop. */
export function CustomerMessages() {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("c");
  const [list, setList] = useState<ConnectConversationSummaryDto[] | null>(null);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  const load = useCallback(() => {
    connectApi<ConnectConversationSummaryDto[]>(`me/conversations?archived=${archived}${q ? `&q=${encodeURIComponent(q)}` : ""}`)
      .then((r) => { setList(r); setError(null); })
      .catch((e) => setError(connectErrorText(e)));
  }, [q, archived]);

  useEffect(() => {
    if (!connectLinksEnabled()) return;
    const t = setTimeout(load, q ? 250 : 0);
    const sock = getRealtimeSocket();
    sock.on("connect.message", load);
    return () => {
      clearTimeout(t);
      sock.off("connect.message", load);
    };
  }, [load, q]);

  if (!connectLinksEnabled()) return <div className={`${s.root} ${s.page}`}><div className={s.empty}><h1 className={s.h1}>Messages</h1><p>Messages are not available yet.</p></div></div>;

  const open = (id: string | null) => router.replace(id ? `/account/messages?c=${id}` : "/account/messages", { scroll: false });
  const savePrefs = async (patch: Partial<Prefs>) => {
    try {
      setPrefs(await connectApi<Prefs>("me/prefs", "PUT", patch));
    } catch (e) {
      setError(connectErrorText(e));
    }
  };

  return (
    <div className={`${s.root} ${s.page}`}>
      <div className={s.between}>
        <h1 className={s.h1}>Messages</h1>
        <button type="button" className={`${s.ghost} ${s.small}`} onClick={() => { setShowPrefs((x) => !x); if (!prefs) void connectApi<Prefs>("me/prefs").then(setPrefs); }}>Privacy & notifications</button>
      </div>
      {showPrefs && prefs && (
        <section className={s.card} aria-label="Message settings">
          {([
            ["showOnline", "Show salons when I am online"],
            ["showLastActive", "Show my last active time"],
            ["notificationPreviews", "Show message text in phone notifications"],
            ["promotionalMessages", "Receive offers and rebooking reminders from salons (you can stop any time by replying STOP)"],
          ] as const).map(([k, label]) => (
            <label key={k} className={s.row}><input type="checkbox" checked={prefs[k]} onChange={(e) => void savePrefs({ [k]: e.target.checked })} /> {label}</label>
          ))}
          <p className={s.muted}>Booking updates always reach you. Your phone number is never shared in chat.</p>
        </section>
      )}
      {error && <p className={s.bannerError} role="alert">{error}</p>}
      <div className={s.split}>
        <section className={`${s.panel} ${active ? s.hideOnPhone : ""}`} aria-label="Conversations">
          <div className={s.panelBody}>
            <input className={s.input} type="search" placeholder="Search salons or messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
            <div className={s.row}>
              <button type="button" className={s.folder} aria-pressed={!archived} onClick={() => setArchived(false)}>Inbox</button>
              <button type="button" className={s.folder} aria-pressed={archived} onClick={() => setArchived(true)}>Archived</button>
            </div>
          </div>
          <div className={s.list}>
            {list === null && <><div className={s.skeleton} /><div className={s.skeleton} /></>}
            {list?.length === 0 && (
              <div className={s.empty}>
                <p>No conversations yet.</p>
                <p className={s.muted}>A chat opens automatically when you book. You can also tap “Chat with Salon” on any booking.</p>
                <Link className={s.btn} href="/account/bookings">My appointments</Link>
              </div>
            )}
            {list?.map((c) => (
              <button key={c.id} type="button" className={s.item} aria-current={c.id === active} onClick={() => open(c.id)}>
                <span className={s.between}><span className={s.itemTitle}>{c.title}</span>{c.unread > 0 && <span className={s.unread} aria-label={`${c.unread} unread`}>{c.unread}</span>}</span>
                <span className={s.muted}>{c.subtitle}</span>
                <span className={s.itemPreview}>{c.lastMessage ?? ""}</span>
                {c.lastMessageAt && <span className={s.muted} style={{ fontSize: "0.72rem" }}>{whenLabel(c.lastMessageAt)}{c.muted ? " · muted" : ""}</span>}
              </button>
            ))}
          </div>
        </section>
        {active ? (
          <ChatThread key={active} conversationId={active} side="CUSTOMER" onBack={() => open(null)} />
        ) : (
          <div className={`${s.thread} ${s.hideOnPhone}`}><div className={s.empty}><p>Choose a conversation.</p></div></div>
        )}
      </div>
    </div>
  );
}
