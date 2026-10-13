"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { notificationTypeLabel } from "@barbercue/shared";
import type { NotificationDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { formatShopDate, formatShopTime } from "./format";
import { useOwnerShell } from "./OwnerShell";
import { Badge, Banner, Btn, Card, EmptyState, PageHead, Skeleton } from "./parts";
import ui from "./owner.module.css";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${formatShopDate(iso, null)} ${formatShopTime(iso, null)}`;
}

/** The notification center: everything the app told this user, newest first, with read/unread. */
export function NotificationsPanel() {
  const router = useRouter();
  const { user } = useAuth();
  const { refreshCounts } = useOwnerShell();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback((cursor?: string) =>
    apiFetch<PaginatedResult<NotificationDto>>(`notifications/mine${cursor ? `?cursor=${cursor}` : ""}`)
      .then((page) => {
        setItems((cur) => (cursor && cur ? [...cur, ...page.items] : page.items));
        setNext(page.nextCursor);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load notifications.")), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function open(n: NotificationDto) {
    if (!n.readAt) {
      await apiFetch(`notifications/${n.id}/read`, { method: "POST", body: "{}" }).catch(() => {});
      setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      refreshCounts();
    }
    if (n.deepLink) router.push(`/${n.deepLink.replace(/^\/+/, "")}`);
  }

  async function markAll() {
    await apiFetch("notifications/mine/read-all", { method: "POST", body: "{}" }).catch(() => {});
    setItems((cur) => cur?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
    refreshCounts();
  }

  const unread = items?.filter((n) => !n.readAt).length ?? 0;
  return (
    <>
      <PageHead
        eyebrow="Shop"
        title="Notifications"
        sub="New bookings, cancellations, customers who joined the Live Queue and assignments — also sent to your phone as push notifications when the app is installed."
        actions={unread > 0 ? <Btn onClick={() => void markAll()}>Mark all as read</Btn> : undefined}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {!items && !error && <Skeleton height={140} />}
      {items && (
        <Card>
          {items.length === 0 ? (
            <EmptyState title="You are all caught up">Alerts appear here as they happen.</EmptyState>
          ) : (
            <ul className={ui.list}>
              {items.map((n) => {
                const message = typeof n.payload?.message === "string" ? n.payload.message : null;
                return (
                  <li key={n.id} className={ui.listRow} style={{ alignItems: "flex-start" }}>
                    <span className={`${ui.dot} ${n.readAt ? ui.dotOff : ui.dotInfo}`} style={{ marginTop: 6 }} aria-hidden="true" />
                    <div className={ui.listMain}>
                      <div className={ui.listTitle} style={{ whiteSpace: "normal" }}>
                        {notificationTypeLabel(user?.preferredLanguage, n.type)} {!n.readAt && <Badge tone="info">New</Badge>}
                      </div>
                      {message && <div className={ui.listSub}>{message}</div>}
                      <div className={ui.listSub}>{timeAgo(n.createdAt)}</div>
                    </div>
                    {(n.deepLink || !n.readAt) && (
                      <Btn small onClick={() => void open(n)}>
                        {n.deepLink ? "Open" : "Mark read"}
                      </Btn>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {next && (
            <div className={ui.mt12}>
              <Btn disabled={more} onClick={() => { setMore(true); void load(next).finally(() => setMore(false)); }}>
                {more ? "Loading…" : "Load more"}
              </Btn>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
