"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConnectBookingCardDto, ConnectConversationSummaryDto, ConnectMessageDto } from "@barbercue/shared";
import { ApiError, apiFetch } from "./api";
import { getRealtimeSocket, onReconnect } from "./realtime";

/** FastQue Connect client. The server decides every permission, price and availability. */
export { connectLinksEnabledFlag as connectLinksEnabled } from "./dashboard-flags";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export function connectApi<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  return apiFetch<T>(`connect/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1").replace(/\/+$/, "");
/** Signed media URLs are relative to the API root ("connect/media/…"). */
export const mediaUrl = (relative: string) => `${API_BASE}/${relative.replace(/^\/+/, "")}`;

export function connectUpload(conversationId: string, file: Blob, name: string): Promise<{ id: string; mimeType: string; url: string }> {
  const form = new FormData();
  form.append("file", file, name);
  return apiFetch(`connect/conversations/${conversationId}/attachments`, { method: "POST", body: form });
}

export function connectErrorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You are offline. The message will be sent when you are back online.";
  return "Something went wrong. Please try again.";
}

export const newClientId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}`).slice(0, 32);

export interface ConnectDetail {
  id: string;
  kind: string;
  side: "CUSTOMER" | "SALON";
  role: string | null;
  card: ConnectBookingCardDto | null;
  lifecycle: { status: "ACTIVE" | "READ_ONLY"; writableUntil: string | null; reason: string | null };
  presence: { online: boolean | null; lastActiveAt: string | null };
  lastMessageSeq: number;
  muted: boolean;
  archived: boolean;
  blockedByMe: boolean;
  blockedByOther: boolean;
  hasOpenComplaint: boolean;
  flags: { ai: boolean; actions: boolean; quotations: boolean; translation: boolean; location: boolean };
  // Salon side only:
  title?: string;
  priority?: string;
  awaiting?: string;
  tags?: string[];
  sentiment?: string | null;
  sentimentReason?: string | null;
  aiHandled?: boolean;
  summary?: string | null;
  summaryAt?: string | null;
  assignedToUserId?: string | null;
  lastSalonReplySeq?: number;
  replyingNow?: { userId: string; name: string } | null;
  canAssign?: boolean;
  staff?: { userId: string; name: string; role: string }[];
}

export type { ConnectConversationSummaryDto, ConnectMessageDto };

/** Pending sends survive a reload/offline period in this browser only, then retry with the same id. */
interface Pending {
  clientMessageId: string;
  body: string;
  replyToId?: string;
  createdAt: string;
  failed?: string;
}
const pendingKey = (id: string) => `fq-connect-pending:${id}`;
function readPending(id: string): Pending[] {
  try {
    return JSON.parse(window.localStorage.getItem(pendingKey(id)) ?? "[]") as Pending[];
  } catch {
    return [];
  }
}
function writePending(id: string, list: Pending[]) {
  try {
    window.localStorage.setItem(pendingKey(id), JSON.stringify(list.slice(-20)));
  } catch {
    /* private window: still works, just not across reloads */
  }
}

/**
 * One conversation: messages (cursor pagination by seq), live updates (ids-only socket pulses →
 * refetch), reconnect catch-up, offline queue with idempotent retry, read receipts.
 */
export function useConversation(id: string | null) {
  const [detail, setDetail] = useState<ConnectDetail | null>(null);
  const [messages, setMessages] = useState<ConnectMessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const lastSeq = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await connectApi<ConnectDetail>(`conversations/${id}`));
      setError(null);
    } catch (e) {
      setError(connectErrorText(e));
    }
  }, [id]);

  const loadLatest = useCallback(async () => {
    if (!id) return;
    try {
      const r = await connectApi<{ messages: ConnectMessageDto[]; hasMore: boolean }>(`conversations/${id}/messages?limit=40`);
      setMessages(r.messages);
      setHasMore(r.hasMore);
      lastSeq.current = r.messages.length ? r.messages[r.messages.length - 1].seq : 0;
      if (lastSeq.current) void connectApi(`conversations/${id}/read`, "POST", { seq: lastSeq.current }).catch(() => undefined);
    } catch (e) {
      setError(connectErrorText(e));
    }
  }, [id]);

  const loadOlder = useCallback(async () => {
    if (!id || !messages.length) return;
    const r = await connectApi<{ messages: ConnectMessageDto[]; hasMore: boolean }>(`conversations/${id}/messages?limit=40&before=${messages[0].seq}`);
    setMessages((m) => [...r.messages, ...m]);
    setHasMore(r.hasMore);
  }, [id, messages]);

  const refresh = useCallback(() => {
    void loadDetail();
    void loadLatest();
  }, [loadDetail, loadLatest]);

  const flush = useCallback(async () => {
    if (!id) return;
    const list = readPending(id);
    for (const p of list) {
      try {
        await connectApi(`conversations/${id}/messages`, "POST", { clientMessageId: p.clientMessageId, body: p.body, replyToId: p.replyToId });
        writePending(id, readPending(id).filter((x) => x.clientMessageId !== p.clientMessageId));
      } catch (e) {
        // A real refusal (read-only, blocked, too long) is shown with a retry/discard choice; a network
        // failure stays queued for the next reconnect.
        if (e instanceof ApiError) writePending(id, readPending(id).map((x) => (x.clientMessageId === p.clientMessageId ? { ...x, failed: e.message } : x)));
        break;
      }
    }
    setPending(readPending(id));
    void loadLatest();
  }, [id, loadLatest]);

  useEffect(() => {
    if (!id) return;
    setPending(readPending(id));
    refresh();
    void flush();
    const s = getRealtimeSocket();
    const onMsg = (p: { conversationId: string }) => {
      if (p.conversationId !== id) return;
      setTyping(false);
      void loadLatest();
    };
    const onUpd = (p: { conversationId: string }) => {
      if (p.conversationId === id) refresh();
    };
    const onRead = (p: { conversationId: string }) => {
      if (p.conversationId === id) void loadLatest();
    };
    const onTyping = (p: { conversationId: string }) => {
      if (p.conversationId !== id) return;
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 4000);
    };
    s.on("connect.message", onMsg);
    s.on("connect.updated", onUpd);
    s.on("connect.read", onRead);
    s.on("connect.typing", onTyping);
    const offRe = onReconnect(() => {
      refresh();
      void flush();
    });
    const online = () => void flush();
    window.addEventListener("online", online);
    // A slow safety net for a missed pulse; the socket is the primary signal.
    const poll = setInterval(() => void loadDetail(), 60_000);
    return () => {
      s.off("connect.message", onMsg);
      s.off("connect.updated", onUpd);
      s.off("connect.read", onRead);
      s.off("connect.typing", onTyping);
      offRe();
      window.removeEventListener("online", online);
      clearInterval(poll);
    };
  }, [id, refresh, flush, loadLatest, loadDetail]);

  const send = useCallback(
    async (input: { body?: string; replyToId?: string; attachmentIds?: string[]; templateKey?: string; fromSuggestionId?: string }) => {
      if (!id) return;
      const clientMessageId = newClientId();
      const lastSeenSeq = lastSeq.current;
      try {
        await connectApi(`conversations/${id}/messages`, "POST", { clientMessageId, lastSeenSeq, ...input });
        await loadLatest();
        void loadDetail();
      } catch (e) {
        if (!(e instanceof ApiError) && input.body && !input.attachmentIds?.length) {
          // Offline / network: queue it with the same id so a retry can never duplicate it.
          writePending(id, [...readPending(id), { clientMessageId, body: input.body, replyToId: input.replyToId, createdAt: new Date().toISOString() }]);
          setPending(readPending(id));
          return;
        }
        throw e;
      }
    },
    [id, loadLatest, loadDetail],
  );

  const discardPending = useCallback(
    (clientMessageId: string) => {
      if (!id) return;
      writePending(id, readPending(id).filter((p) => p.clientMessageId !== clientMessageId));
      setPending(readPending(id));
    },
    [id],
  );

  const lastTypingSent = useRef(0);
  const notifyTyping = useCallback(() => {
    if (!id || Date.now() - lastTypingSent.current < 3000) return;
    lastTypingSent.current = Date.now();
    void connectApi(`conversations/${id}/typing`, "POST").catch(() => undefined);
  }, [id]);

  return { detail, messages, hasMore, error, typing, pending, send, refresh, loadOlder, flush, discardPending, notifyTyping, reloadDetail: loadDetail };
}

/** Customer unread total for the menu badge. */
export function useConnectUnread(enabled: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => connectApi<{ unread: number }>("me/unread").then((r) => alive && setN(r.unread)).catch(() => undefined);
    void load();
    const s = getRealtimeSocket();
    s.on("connect.message", load);
    return () => {
      alive = false;
      s.off("connect.message", load);
    };
  }, [enabled]);
  return n;
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

const IST = { timeZone: "Asia/Kolkata" } as const;
export const msgTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" });
export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short" });
export const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
