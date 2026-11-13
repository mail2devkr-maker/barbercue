"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DASHBOARD_PATHS, formatVoiceDateTime, type OwnerBookingDetailDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { getRealtimeSocket, joinSalonRoom } from "../../lib/realtime";
import { claimOwnerAlert } from "../../lib/owner-alert-dedupe";
import { getVoiceEnabled, ownerVoiceAnnouncements, speakOwnerVoice } from "../../lib/voice-preference";

interface QueueJoinedPayload {
  salonId?: string;
  queueEntryId?: string;
  tokenNumber?: number | null;
  serviceName?: string | null;
}

type Toast = { id: string; kind: "booking" | "queue"; title: string; body: string; href: string };

const TOAST_MS = 8000;

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Owner-reported (13 Nov): new-booking and Live Queue join alerts only worked while the Bookings or
 * Live Queue page was open. Mounted once in the owner shell, this announces both on EVERY dashboard
 * page: an on-screen card, the chime + spoken announcement (when the owner has switched voice
 * alerts on), and a system notification when the FastQue tab is in the background (after the owner
 * allows notifications once). Each event is claimed through owner-alert-dedupe, so the Bookings and
 * Live Queue pages never announce the same event a second time.
 */
export function OwnerLiveAlerts({ salonId, basePath }: { salonId: string; basePath: string }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const audio = useRef<AudioContext | null>(null);
  const languageRef = useRef(user?.preferredLanguage);
  const pathRef = useRef(pathname);
  useEffect(() => {
    languageRef.current = user?.preferredLanguage;
    pathRef.current = pathname;
  }, [user?.preferredLanguage, pathname]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the browser's permission once on mount
    setPermission(notificationsSupported() ? Notification.permission : "unsupported");
  }, []);

  // Browsers only allow sound after a user gesture: unlock the chime on the first tap/click anywhere.
  useEffect(() => {
    const unlock = () => {
      try {
        const ctx = audio.current ?? new window.AudioContext();
        audio.current = ctx;
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        /* no Web Audio: alerts stay visual */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const chime = useCallback((tones: [number, number]) => {
    const ctx = audio.current;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    tones.forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.14 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.16);
    });
  }, []);

  const raise = useCallback(
    (toast: Toast, onPage: boolean) => {
      if (!onPage) {
        setToasts((cur) => [toast, ...cur.filter((t) => t.id !== toast.id)].slice(0, 3));
        window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== toast.id)), TOAST_MS);
      }
      if (document.visibilityState === "hidden" && notificationsSupported() && Notification.permission === "granted") {
        try {
          const n = new Notification(toast.title, { body: toast.body, tag: toast.id });
          n.onclick = () => {
            window.focus();
            router.push(toast.href);
            n.close();
          };
        } catch {
          /* some browsers only allow notifications from a service worker; the card still shows */
        }
      }
    },
    [router],
  );

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const hindi = () => languageRef.current === "HI";
    const bookingsHref = `${basePath}/bookings`;
    const queueHref = `${basePath}/queue`;

    function onBookingCreated(payload: { salonId?: string; bookingId?: string }) {
      if (payload?.salonId !== salonId || !payload.bookingId) return;
      const bookingId = payload.bookingId;
      const onPage = Boolean(pathRef.current?.endsWith("/bookings"));
      apiFetch<OwnerBookingDetailDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}/${bookingId}`)
        .then((detail) => {
          const what = detail.serviceName ? ` · ${detail.serviceName}` : "";
          raise({
            id: `booking:${bookingId}`,
            kind: "booking",
            title: hindi() ? "नई बुकिंग" : "New booking",
            body: `${detail.salonName ?? ""}${what}`.replace(/^ · /, "") || (hindi() ? "आपकी दुकान में नई बुकिंग आई।" : "A new booking was made for your shop."),
            href: bookingsHref,
          }, onPage);
          if (!getVoiceEnabled() || !claimOwnerAlert("booking.created", bookingId)) return;
          chime([523, 784]);
          const { date, time } = detail.slotStart && detail.salonTimezone
            ? formatVoiceDateTime(detail.slotStart, detail.salonTimezone)
            : { date: null, time: null };
          speakOwnerVoice(
            ownerVoiceAnnouncements(languageRef.current).newBookingReceived(
              detail.serviceName ?? null,
              detail.assignedStaffName ?? detail.preferredStaffName ?? null,
              detail.salonName ?? null,
              date,
              time,
            ),
            languageRef.current,
          );
        })
        .catch(() => {
          raise({ id: `booking:${bookingId}`, kind: "booking", title: hindi() ? "नई बुकिंग" : "New booking", body: "", href: bookingsHref }, onPage);
        });
    }

    function onQueueJoined(payload: QueueJoinedPayload) {
      if (payload?.salonId !== salonId || !payload.queueEntryId) return;
      const token = typeof payload.tokenNumber === "number" ? payload.tokenNumber : null;
      const service = payload.serviceName ?? null;
      const onPage = Boolean(pathRef.current?.endsWith("/queue"));
      raise({
        id: `queue:${payload.queueEntryId}`,
        kind: "queue",
        title: hindi() ? "Live Queue में नया ग्राहक" : "New customer in Live Queue",
        body: [token !== null ? `#${token}` : null, service].filter(Boolean).join(" · "),
        href: `${queueHref}?view=waiting`,
      }, onPage);
      if (!getVoiceEnabled() || token === null || !claimOwnerAlert("queue.joined", payload.queueEntryId)) return;
      chime([660, 880]);
      speakOwnerVoice(ownerVoiceAnnouncements(languageRef.current).newCustomerJoined(token, service), languageRef.current);
    }

    socket.on("booking.created", onBookingCreated);
    socket.on("queue.entry.joined", onQueueJoined);
    return () => {
      socket.off("booking.created", onBookingCreated);
      socket.off("queue.entry.joined", onQueueJoined);
    };
  }, [salonId, basePath, chime, raise]);

  const askPermission = () => {
    if (!notificationsSupported()) return;
    void Notification.requestPermission().then(setPermission).catch(() => {});
  };

  return (
    <div aria-live="polite" style={{ position: "fixed", top: 76, right: 16, zIndex: 60, display: "grid", gap: 8, width: "min(360px, calc(100vw - 32px))" }}>
      {permission === "default" ? (
        <button
          type="button"
          onClick={askPermission}
          style={{ justifySelf: "end", border: "1px solid #F20A83", background: "rgba(20,12,18,0.92)", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
        >
          {user?.preferredLanguage === "HI" ? "🔔 बुकिंग/कतार अलर्ट चालू करें" : "🔔 Turn on booking & queue alerts"}
        </button>
      ) : null}
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          data-testid="owner-live-alert"
          onClick={() => {
            setToasts((cur) => cur.filter((t) => t.id !== toast.id));
            router.push(toast.href);
          }}
          style={{ textAlign: "left", border: "1px solid #F20A83", background: "rgba(20,12,18,0.96)", color: "#fff", borderRadius: 14, padding: "12px 14px", boxShadow: "0 10px 30px rgba(0,0,0,0.35)", cursor: "pointer" }}
        >
          <strong style={{ display: "block", fontSize: 14 }}>{toast.kind === "queue" ? "👥 " : "📅 "}{toast.title}</strong>
          {toast.body ? <span style={{ display: "block", fontSize: 13, opacity: 0.85, marginTop: 2 }}>{toast.body}</span> : null}
        </button>
      ))}
    </div>
  );
}
