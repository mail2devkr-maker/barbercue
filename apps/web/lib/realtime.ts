"use client";

import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "./api";

// The `/realtime` WS gateway lives at the backend's origin, not behind the REST `/api/v1` prefix
// (Nest's global prefix only applies to HTTP controllers). It also has to be an origin the
// BROWSER can reach directly — Next's rewrites() proxy (see next.config.ts) only forwards plain
// HTTP request/response traffic under /api/v1/*, not a WebSocket upgrade on a different path, so
// this connection is deliberately NOT routed through it and stays a direct, real, public origin.
// NEXT_PUBLIC_API_BASE_URL can't supply that any more in production — it's the relative "/api/v1"
// lib/api.ts needs for same-origin cookies — so this reads a dedicated public var instead, falling
// back to parsing NEXT_PUBLIC_API_BASE_URL only when it happens to be absolute (local dev, where
// apps/web/.env.local still sets it to http://localhost:3000/api/v1 and this var is unset).
function resolveRealtimeOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_BACKEND_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1").origin;
  } catch {
    return "http://localhost:3000";
  }
}
const REALTIME_ORIGIN = resolveRealtimeOrigin();

let socket: Socket | null = null;
// Phase 15 (Low-Network / Resilience Mode). Socket.IO's `reconnection: true` re-establishes the
// underlying connection automatically, but the SERVER'S room membership for that connection does
// not survive a disconnect — join:salon has to be re-emitted, or a client that briefly lost
// network silently stops receiving queue.updated/etc. for a salon it's still viewing until the
// page is reloaded. Tracked client-side (not server-side) because the gateway itself has no
// concept of "rooms this now-dead connection used to be in" to hand back.
const joinedSalonIds = new Set<string>();

/**
 * A single shared socket for the whole tab, connected lazily on first use. `auth` is a callback
 * (not a static object) so every reconnect attempt picks up the current in-memory access token
 * rather than one captured at connect time — the token rotates roughly every 15 minutes.
 */
export function getRealtimeSocket(): Socket {
  if (!socket) {
    socket = io(`${REALTIME_ORIGIN}/realtime`, {
      autoConnect: false,
      reconnection: true,
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    // Fires on the initial connect AND every reconnect — re-joining is idempotent server-side, so
    // there's no need to distinguish the two here.
    socket.on("connect", () => {
      for (const salonId of joinedSalonIds) socket!.emit("join:salon", { salonId });
    });
  }
  if (!socket.connected) socket.connect();
  return socket;
}

/** Joins `salon:{salonId}` — required to receive `queue.updated`/`staff.status.changed` for that
 * salon; `customer:{userId}` is joined automatically by the gateway on connect. */
export function joinSalonRoom(salonId: string): void {
  joinedSalonIds.add(salonId);
  getRealtimeSocket().emit("join:salon", { salonId });
}

/**
 * Runs `callback` after every successful RECONNECT (not the initial connect) — the moment a
 * component's own realtime-driven state might have gone stale because events were missed while
 * disconnected (the backend never replays missed events; see realtime.gateway.ts's ids-only
 * convention). Callers pass their own refetch function. Returns an unsubscribe function for
 * cleanup in a useEffect.
 */
export function onReconnect(callback: () => void): () => void {
  const s = getRealtimeSocket();
  s.io.on("reconnect", callback);
  return () => {
    s.io.off("reconnect", callback);
  };
}
