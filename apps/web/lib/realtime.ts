"use client";

import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "./api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
// The `/realtime` WS gateway lives at the backend's origin, not behind the REST `/api/v1` prefix
// (Nest's global prefix only applies to HTTP controllers) — so strip the path, keep the origin.
const REALTIME_ORIGIN = new URL(API_BASE_URL).origin;

let socket: Socket | null = null;

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
  }
  if (!socket.connected) socket.connect();
  return socket;
}

/** Joins `salon:{salonId}` — required to receive `queue.updated`/`staff.status.changed` for that
 * salon; `customer:{userId}` is joined automatically by the gateway on connect. */
export function joinSalonRoom(salonId: string): void {
  getRealtimeSocket().emit("join:salon", { salonId });
}
